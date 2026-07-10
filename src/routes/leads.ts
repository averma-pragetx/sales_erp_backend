import { Router, Request, Response } from 'express';
import { Lead } from '../models/Lead';
import { Inquiry } from '../models/Inquiry';

const router = Router();

// GET / — list all leads sorted by createdAt desc
router.get('/', async (_req: Request, res: Response) => {
  try {
    const leads = await Lead.find().lean().sort({ createdAt: -1 });
    res.json(leads);
  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// GET /:id — get one lead by leadId
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const leadId = decodeURIComponent(req.params.id);
    const lead = await Lead.findOne({ leadId }).lean();
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    res.json(lead);
  } catch (error) {
    console.error('Error fetching lead:', error);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// POST / — create a new lead
router.post('/', async (req: Request, res: Response) => {
  try {
    const lead = new Lead({ ...req.body, status: 'new', pushedInquiryId: null });
    const saved = await lead.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating lead:', error);
    res.status(400).json({ error: 'Failed to create lead', details: error });
  }
});

// PATCH /:id/approve — mark lead as approved
router.patch('/:id/approve', async (req: Request, res: Response) => {
  try {
    const leadId = decodeURIComponent(req.params.id);
    const lead = await Lead.findOne({ leadId });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Lead already pushed to sales' });
      return;
    }
    lead.status = 'approved';
    await lead.save();
    res.json(lead);
  } catch (error) {
    console.error('Error approving lead:', error);
    res.status(500).json({ error: 'Failed to approve lead' });
  }
});

// PATCH /:id/reject — mark lead as rejected
router.patch('/:id/reject', async (req: Request, res: Response) => {
  try {
    const leadId = decodeURIComponent(req.params.id);
    const lead = await Lead.findOne({ leadId });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Lead already pushed to sales' });
      return;
    }
    lead.status = 'rejected';
    await lead.save();
    res.json(lead);
  } catch (error) {
    console.error('Error rejecting lead:', error);
    res.status(500).json({ error: 'Failed to reject lead' });
  }
});

// POST /:id/push-to-sales — create an Inquiry (Intake stage) from this lead
router.post('/:id/push-to-sales', async (req: Request, res: Response) => {
  try {
    const leadId = decodeURIComponent(req.params.id);
    const lead = await Lead.findOne({ leadId });
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }
    if (lead.status === 'pushed') {
      res.status(400).json({ error: 'Lead already pushed to sales' });
      return;
    }
    if (lead.status === 'rejected') {
      res.status(400).json({ error: 'Cannot push a rejected lead to sales' });
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
      scope: lead.tenderRef || lead.title,
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
      estimator: lead.assignedTo || 'Unassigned',
      completedUpTo: 0,
    });
    const savedInquiry = await inquiry.save();

    lead.status = 'pushed';
    lead.pushedInquiryId = inquiryId;
    await lead.save();

    res.json({ lead, inquiry: savedInquiry });
  } catch (error) {
    console.error('Error pushing lead to sales:', error);
    res.status(500).json({ error: 'Failed to push lead to sales' });
  }
});

export default router;
