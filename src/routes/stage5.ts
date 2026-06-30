import { Router, Request, Response } from 'express';
import { Stage5Work } from '../models/Stage5Work';
import { Inquiry }    from '../models/Inquiry';
import { Section }    from '../models/Section';
import { analyseCompliance } from '../services/stage5';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recomputeMeta(work: InstanceType<typeof Stage5Work>) {
  const items = work.complianceMatrix;
  const eff = (i: typeof items[0]) => i.statusOverride ?? i.status;

  work.complianceMeta.totalComplianceItems = items.length;
  work.complianceMeta.compliantCount       = items.filter(i => eff(i) === 'Compliant').length;
  work.complianceMeta.deviationCount       = items.filter(i => eff(i) === 'Deviation').length;
  work.complianceMeta.blockerCount         = items.filter(i => eff(i) === 'Blocker').length;
  work.complianceMeta.openUnderReviewCount = items.filter(i => eff(i) === 'Under review').length;
}

function formatWork(work: InstanceType<typeof Stage5Work>) {
  return {
    inquiryId:        work.inquiryId,
    status:           work.status,
    error:            work.error,
    complianceMeta:   work.complianceMeta,
    complianceMatrix: work.complianceMatrix,
    analyzedAt:       work.analyzedAt,
  };
}

// ─── GET /api/stage5/:inquiryId ───────────────────────────────────────────────

router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage5Work.findOne({ inquiryId });
    if (!work) {
      res.json({
        inquiryId,
        status: 'pending',
        error: '',
        complianceMeta: {
          tclDocumentRef: '', tclRevision: '', totalComplianceItems: 0,
          compliantCount: 0, deviationCount: 0, openUnderReviewCount: 0,
          blockerCount: 0, categories: [],
        },
        complianceMatrix: [],
        analyzedAt: null,
      });
      return;
    }
    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage5] get error:', err);
    res.status(500).json({ error: 'Failed to fetch Stage 5 data.' });
  }
});

// ─── POST /api/stage5/:inquiryId/analyse ─────────────────────────────────────

router.post('/:inquiryId/analyse', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
      return;
    }

    const sections = await Section.find({ inquiryId })
      .sort({ documentId: 1, sectionIndex: 1 })
      .lean();

    if (!sections.length) {
      res.status(422).json({
        error: 'No extracted sections found. Run Stage 2 document review first.',
      });
      return;
    }

    // ── Guard concurrent runs ─────────────────────────────────────────────────
    let work = await Stage5Work.findOne({ inquiryId });
    if (work?.status === 'processing') {
      const age = Date.now() - new Date(work.updatedAt).getTime();
      if (age < 5 * 60 * 1000) {
        res.status(409).json({ error: 'Analysis already in progress.' });
        return;
      }
      work.status = 'failed';
      work.error  = 'Previous run timed out.';
      await work.save();
    }

    if (!work) work = new Stage5Work({ inquiryId });
    work.status = 'processing';
    work.error  = '';
    await work.save();

    const scope = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;

    const result = await analyseCompliance(
      inquiryId,
      scope,
      sections.map(s => ({
        docType:       s.docType,
        documentTitle: s.documentTitle,
        title:         s.title,
        content:       s.content,
      })),
    );

    work.complianceMeta   = result.complianceMeta;
    work.complianceMatrix = result.complianceMatrix;
    work.status           = 'done';
    work.analyzedAt       = new Date();
    work.error            = '';
    await work.save();

    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage5] analyse error:', err);
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage5Work.findOne({ inquiryId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }
    res.status(500).json({ error: 'Compliance analysis failed.', details: String(err) });
  }
});

// ─── POST /api/stage5/:inquiryId/items ───────────────────────────────────────

router.post('/:inquiryId/items', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const {
      clauseId, sourceRef, topic, category,
      rfqBuyerRequirement, oswalStandOffer, impact, status, owner, remarks,
    } = req.body as Partial<{
      clauseId: string; sourceRef: string; topic: string; category: string;
      rfqBuyerRequirement: string; oswalStandOffer: string; impact: string;
      status: string; owner: string; remarks: string;
    }>;

    if (!topic?.trim() || !rfqBuyerRequirement?.trim()) {
      res.status(400).json({ error: 'topic and rfqBuyerRequirement are required.' });
      return;
    }

    let work = await Stage5Work.findOne({ inquiryId });
    if (!work) {
      work = new Stage5Work({ inquiryId, status: 'done' });
    }
    if (work.status === 'pending') work.status = 'done';

    const effectiveStatus = status?.trim() || 'Under review';
    const newItem = {
      clauseId:            clauseId?.trim() || `MAN-${Date.now()}`,
      sourceRef:           sourceRef?.trim() || 'Manual',
      topic:               topic.trim(),
      category:            category?.trim() || 'Technical',
      rfqBuyerRequirement: rfqBuyerRequirement.trim(),
      oswalStandOffer:     oswalStandOffer?.trim() || '',
      impact:              impact?.trim() || '',
      status:              effectiveStatus,
      owner:               owner?.trim() || '',
      compliantFlag:       effectiveStatus === 'Compliant',
      deviationFlag:       effectiveStatus === 'Deviation',
      blockerFlag:         effectiveStatus === 'Blocker',
      openFlag:            effectiveStatus === 'Under review',
      statusOverride:      null,
      ownerOverride:       null,
      remarks:             remarks?.trim() || '',
    };

    work.complianceMatrix.push(newItem as any);
    recomputeMeta(work);
    work.markModified('complianceMatrix');
    work.markModified('complianceMeta');
    await work.save();

    res.status(201).json(formatWork(work));
  } catch (err) {
    console.error('[stage5] add item error:', err);
    res.status(500).json({ error: 'Failed to add item.', details: String(err) });
  }
});

// ─── PATCH /api/stage5/:inquiryId/items/:itemIndex ───────────────────────────

router.patch('/:inquiryId/items/:itemIndex', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const itemIndex = parseInt(req.params.itemIndex, 10);

    if (isNaN(itemIndex) || itemIndex < 0) {
      res.status(400).json({ error: 'Invalid item index.' });
      return;
    }

    const work = await Stage5Work.findOne({ inquiryId });
    if (!work) {
      res.status(404).json({ error: 'Stage 5 data not found.' });
      return;
    }
    if (itemIndex >= work.complianceMatrix.length) {
      res.status(404).json({ error: `Item index ${itemIndex} out of range.` });
      return;
    }

    const {
      topic, category, sourceRef, rfqBuyerRequirement,
      oswalStandOffer, impact, status, owner,
      statusOverride, ownerOverride, remarks,
    } = req.body as {
      topic?: string; category?: string; sourceRef?: string;
      rfqBuyerRequirement?: string; oswalStandOffer?: string;
      impact?: string; status?: string; owner?: string;
      statusOverride?: string | null;
      ownerOverride?:  string | null;
      remarks?:        string;
    };

    const item = work.complianceMatrix[itemIndex];

    if (topic               !== undefined) item.topic               = topic.trim();
    if (category            !== undefined) item.category            = category.trim();
    if (sourceRef           !== undefined) item.sourceRef           = sourceRef.trim();
    if (rfqBuyerRequirement !== undefined) item.rfqBuyerRequirement = rfqBuyerRequirement.trim();
    if (oswalStandOffer     !== undefined) item.oswalStandOffer     = oswalStandOffer.trim();
    if (impact              !== undefined) item.impact              = impact.trim();
    if (status              !== undefined) item.status              = status.trim();
    if (owner               !== undefined) item.owner               = owner.trim();
    if (statusOverride      !== undefined) item.statusOverride      = statusOverride || null;
    if (ownerOverride       !== undefined) item.ownerOverride       = ownerOverride  || null;
    if (remarks             !== undefined) item.remarks             = remarks.trim();

    const effectiveStatus = item.statusOverride ?? item.status;
    item.compliantFlag = effectiveStatus === 'Compliant';
    item.deviationFlag = effectiveStatus === 'Deviation';
    item.blockerFlag   = effectiveStatus === 'Blocker';
    item.openFlag      = effectiveStatus === 'Under review';

    recomputeMeta(work);
    work.markModified('complianceMatrix');
    work.markModified('complianceMeta');
    await work.save();

    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage5] patch item error:', err);
    res.status(500).json({ error: 'Failed to update item.', details: String(err) });
  }
});

// ─── DELETE /api/stage5/:inquiryId/items/:itemIndex ──────────────────────────

router.delete('/:inquiryId/items/:itemIndex', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const itemIndex = parseInt(req.params.itemIndex, 10);

    if (isNaN(itemIndex) || itemIndex < 0) {
      res.status(400).json({ error: 'Invalid item index.' });
      return;
    }

    const work = await Stage5Work.findOne({ inquiryId });
    if (!work) { res.status(404).json({ error: 'Stage 5 data not found.' }); return; }
    if (itemIndex >= work.complianceMatrix.length) {
      res.status(404).json({ error: `Item index ${itemIndex} out of range.` });
      return;
    }

    work.complianceMatrix.splice(itemIndex, 1);
    recomputeMeta(work);
    work.markModified('complianceMatrix');
    work.markModified('complianceMeta');
    await work.save();

    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage5] delete item error:', err);
    res.status(500).json({ error: 'Failed to delete item.', details: String(err) });
  }
});

export default router;
