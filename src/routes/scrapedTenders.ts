import { Router, Request, Response } from 'express';
import { ScrapedTender } from '../models/ScrapedTender';
import { TenderLead, ITenderLead } from '../models/TenderLead';
import { Inquiry } from '../models/Inquiry';
import { downloadFromS3, getPresignedUrl } from '../s3';
import { extractTenderMeta } from '../services/tenderExtract';

const router = Router();

// Everything the scraper pipeline uploads today comes from the GeM scraper
const DEFAULT_SCRAPER_ID = 'GEM-OG-01';

// Mirrors any scraped_tenders docs not yet in tender_leads into the tender_leads collection
async function syncNewTenders(): Promise<void> {
  await TenderLead.updateMany(
    { $or: [{ scraperId: { $exists: false } }, { scraperId: '' }] },
    { $set: { scraperId: DEFAULT_SCRAPER_ID } }
  );
  const scraped = await ScrapedTender.find().lean();
  const existingNames = new Set(
    (await TenderLead.find({}, 'tenderName').lean()).map(t => t.tenderName)
  );
  const pending = scraped.filter(t => !existingNames.has(t.tenderName));

  for (const tender of pending) {
    const pdf = tender.files.find(f => f.mimeType === 'application/pdf');
    const zip = tender.files.find(f => f.mimeType === 'application/zip');
    await TenderLead.create({
      tenderName: tender.tenderName,
      scraperId:  DEFAULT_SCRAPER_ID,
      pdfS3Key:   pdf?.s3Key ?? '',
      zipS3Key:   zip?.s3Key ?? '',
    });
  }
}

async function formatLead(lead: ITenderLead) {
  const zipUrl = lead.zipS3Key ? await getPresignedUrl(lead.zipS3Key) : null;

  return {
    tenderName: lead.tenderName,
    scraperId:  lead.scraperId,
    tenderId:   lead.tenderId || lead.tenderName,
    client:     lead.client,
    title:      lead.title || lead.tenderName,
    source:     lead.source,
    value:      lead.value,
    currency:   lead.currency,
    valueUnit:  lead.valueUnit,
    dueDate:    lead.dueDate,
    score:      lead.score,
    analysed:   lead.analysed,
    zipUrl,
    status:          lead.status,
    pushedInquiryId: lead.pushedInquiryId,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

// GET /?page=1&limit=20 — sync any new scraped tenders into tender_leads, then list a page of tender_leads
router.get('/', async (req: Request, res: Response) => {
  try {
    await syncNewTenders();

    const page  = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const filter = req.query.scraperId ? { scraperId: String(req.query.scraperId) } : {};

    const [leads, total] = await Promise.all([
      TenderLead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      TenderLead.countDocuments(filter),
    ]);

    res.json({
      items: await Promise.all(leads.map(formatLead)),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Error fetching scraped tenders:', error);
    res.status(500).json({ error: 'Failed to fetch scraped tenders' });
  }
});

// POST /:id/analyse — run Gemini extraction on this tender's PDF, cache result on tender_leads
router.post('/:id/analyse', async (req: Request, res: Response) => {
  try {
    const tenderName = decodeURIComponent(req.params.id);
    const lead = await TenderLead.findOne({ tenderName });
    if (!lead) {
      res.status(404).json({ error: 'Tender not found' });
      return;
    }
    if (!lead.pdfS3Key) {
      res.status(400).json({ error: 'No PDF found in this tender folder to analyse' });
      return;
    }

    const buffer = await downloadFromS3(lead.pdfS3Key);
    const meta = await extractTenderMeta(buffer.toString('base64'), 'application/pdf');

    lead.tenderId  = meta.tenderId;
    lead.client    = meta.client;
    lead.title     = meta.title;
    lead.source    = meta.source;
    lead.value     = meta.value;
    lead.currency  = meta.currency;
    lead.valueUnit = meta.valueUnit;
    lead.dueDate   = meta.dueDate;
    lead.score     = meta.score;
    lead.analysed  = true;
    await lead.save();

    res.json(await formatLead(lead));
  } catch (error) {
    console.error('Error analysing tender:', error);
    res.status(500).json({ error: (error as Error).message || 'Failed to analyse tender' });
  }
});

// PATCH /:id/approve
router.patch('/:id/approve', async (req: Request, res: Response) => {
  try {
    const tenderName = decodeURIComponent(req.params.id);
    const lead = await TenderLead.findOne({ tenderName });
    if (!lead) {
      res.status(404).json({ error: 'Tender not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Tender already pushed to sales' });
      return;
    }
    lead.status = 'approved';
    await lead.save();
    res.json(await formatLead(lead));
  } catch (error) {
    console.error('Error approving tender:', error);
    res.status(500).json({ error: 'Failed to approve tender' });
  }
});

// PATCH /:id/reject
router.patch('/:id/reject', async (req: Request, res: Response) => {
  try {
    const tenderName = decodeURIComponent(req.params.id);
    const lead = await TenderLead.findOne({ tenderName });
    if (!lead) {
      res.status(404).json({ error: 'Tender not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Tender already pushed to sales' });
      return;
    }
    lead.status = 'rejected';
    await lead.save();
    res.json(await formatLead(lead));
  } catch (error) {
    console.error('Error rejecting tender:', error);
    res.status(500).json({ error: 'Failed to reject tender' });
  }
});

// POST /:id/push-to-sales — create an Inquiry (Intake stage) from this tender
router.post('/:id/push-to-sales', async (req: Request, res: Response) => {
  try {
    const tenderName = decodeURIComponent(req.params.id);
    const lead = await TenderLead.findOne({ tenderName });
    if (!lead) {
      res.status(404).json({ error: 'Tender not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Tender already pushed to sales' });
      return;
    }
    if (lead.status === 'rejected') {
      res.status(400).json({ error: 'Cannot push a rejected tender to sales' });
      return;
    }
    if (!lead.analysed) {
      res.status(400).json({ error: 'Analyse this tender before pushing it to sales' });
      return;
    }

    // Generate the next inquiryId in the OEL/EST/{year}/{seq} sequence
    const year = new Date().getFullYear();
    const prefix = `OEL/EST/${year}/`;
    const existing = await Inquiry.find({ inquiryId: { $regex: `^${prefix}` } })
      .select('inquiryId')
      .lean();
    const nums = existing
      .map(i => parseInt(i.inquiryId.slice(prefix.length), 10))
      .filter(n => !isNaN(n));
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 401;
    const inquiryId = `${prefix}${String(next).padStart(4, '0')}`;

    const due = new Date(lead.dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysToBid = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
    const bidDue = isNaN(due.getTime())
      ? ''
      : due.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).replace(' ', '-');

    const inquiry = new Inquiry({
      inquiryId,
      client: lead.client,
      project: lead.title,
      scope: lead.title,
      value: lead.value,
      currency: lead.currency,
      valueUnit: lead.valueUnit,
      priority: 'P2',
      currentStage: 1,
      currentStageName: 'RFQ Received',
      cluster: 'intake',
      daysToBid,
      bidDue,
      receivedDate: new Date().toISOString().slice(0, 10),
      source: lead.source,
      estimator: 'Unassigned',
      completedUpTo: 0,
    });
    const savedInquiry = await inquiry.save();

    lead.status = 'pushed';
    lead.pushedInquiryId = inquiryId;
    await lead.save();

    res.json({ tender: await formatLead(lead), inquiry: savedInquiry });
  } catch (error) {
    console.error('Error pushing tender to sales:', error);
    res.status(500).json({ error: 'Failed to push tender to sales' });
  }
});

export default router;
