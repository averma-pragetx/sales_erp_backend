import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Stage7Work, IBomItem }  from '../models/Stage7Work';
import { Stage4Work }  from '../models/Stage4Work';
import { Inquiry }     from '../models/Inquiry';
import { estimateBom } from '../services/stage7';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recompute(work: InstanceType<typeof Stage7Work>) {
  for (const item of work.items) {
    item.totalInr = Math.round(item.rateInr * item.quantity);
  }
  work.grandTotalInr = work.items.reduce((sum, i) => sum + i.totalInr, 0);
}

function formatBom(work: InstanceType<typeof Stage7Work>) {
  return {
    inquiryId:     work.inquiryId,
    status:        work.status,
    estimatedAt:   work.estimatedAt,
    grandTotalInr: work.grandTotalInr,
    items: (work.items as IBomItem[]).map((item) => ({
      _id:          item._id,
      tagNumber:    item.tagNumber,
      productName:  item.productName,
      quantity:     item.quantity,
      quantityUnit: item.quantityUnit,
      rateInr:      item.rateInr,
      totalInr:     item.totalInr,
      aiEstimated:  item.aiEstimated,
      rationale:    item.rationale,
      confidence:   item.confidence,
      mocType:          item.mocType,
      notes:        item.notes,
      remarks:      item.remarks,
    })),
  };
}

// ─── GET /api/stage7/:inquiryId ───────────────────────────────────────────────
// Returns saved BOM. Returns empty BOM structure if none exists yet.
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage7Work.findOne({ inquiryId });
    if (!work) {
      res.json({ inquiryId, status: 'pending', grandTotalInr: 0, items: [], estimatedAt: null });
      return;
    }
    res.json(formatBom(work));
  } catch (err) {
    console.error('[stage7] get error:', err);
    res.status(500).json({ error: 'Failed to fetch BOM.' });
  }
});

// ─── POST /api/stage7/:inquiryId/estimate ─────────────────────────────────────
// Pulls tag list from Stage 4, calls Gemini to estimate INR rates, saves BOM.
// Re-running this REPLACES the existing BOM (fresh estimate from current tag list).
// Synchronous — responds with the full BOM directly.
router.post('/:inquiryId/estimate', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    // ── Validate inquiry ─────────────────────────────────────────────────────
    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
      return;
    }

    // ── Pull tag list from Stage 4 ───────────────────────────────────────────
    const stage4 = await Stage4Work.findOne({ inquiryId }).lean();
    if (!stage4 || stage4.status !== 'done' || stage4.tags.length === 0) {
      res.status(422).json({
        error: 'No tag list available. Run Stage 4 extraction first (POST /api/stage4/:inquiryId/extract).',
      });
      return;
    }

    // ── Guard concurrent runs (stale lock: >5 min → allow retry) ───────────
    let work = await Stage7Work.findOne({ inquiryId });
    if (work?.status === 'processing') {
      const staleMs = 5 * 60 * 1000;
      const age     = Date.now() - new Date(work.updatedAt).getTime();
      if (age < staleMs) {
        res.status(409).json({ error: 'Estimation already in progress.' });
        return;
      }
      work.status = 'failed';
      work.error  = 'Previous run timed out.';
      await work.save();
    }

    if (!work) {
      work = new Stage7Work({ inquiryId });
    }
    work.status = 'processing';
    work.error  = '';
    await work.save();

    // ── Call Gemini ──────────────────────────────────────────────────────────
    const scope = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;

    const result = await estimateBom(
      inquiryId,
      scope,
      stage4.tags.map(t => {
        const dimParts = [t.shellOdMm ? `${t.shellOdMm}mm OD` : '', t.tubeLengthMm ? `${t.tubeLengthMm}mm L` : ''].filter(Boolean);
        const notesParts = [
          t.temaType ? `TEMA: ${t.temaType}` : '',
          t.shellSide?.fluid ? `Shell: ${t.shellSide.fluid}` : '',
          t.tubeSide?.fluid  ? `Tube: ${t.tubeSide.fluid}`   : '',
          t.shellSide?.material ? `Shell mat: ${t.shellSide.material}` : '',
        ].filter(Boolean);
        return {
          tagNumber:     t.tagNumber,
          productName:   t.service || t.tagNumber || `Item`,
          dimensions:    dimParts.join(' × ') || 'not specified',
          weightPerUnit: t.weightPerUnitT ? `${t.weightPerUnitT} t` : 'not specified',
          quantity:      String(t.nos || 1),
          notes:         notesParts.join(' | '),
        };
      }),
    );

    // ── Save BOM items ────────────────────────────────────────────────────────
    work.items = result.items.map(p => ({
      _id:          new mongoose.Types.ObjectId(),
      tagNumber:    p.tagNumber,
      productName:  p.productName,
      quantity:     p.quantity,
      quantityUnit: p.quantityUnit,
      rateInr:      p.estimatedRateInr,
      totalInr:     Math.round(p.estimatedRateInr * p.quantity),
      aiEstimated:  true,
      rationale:    p.rationale,
      confidence:   p.confidence,
      mocType:          p.mocType,
      notes:        '',
      remarks:      '',
    }));

    recompute(work);
    work.status      = 'done';
    work.estimatedAt = new Date();
    await work.save();

    res.json(formatBom(work));
  } catch (err) {
    console.error('[stage7] estimate error:', err);

    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage7Work.findOne({ inquiryId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }

    res.status(500).json({ error: 'BOM estimation failed.', details: String(err) });
  }
});

// ─── POST /api/stage7/:inquiryId/items ───────────────────────────────────────
// Manually add a new line item to the BOM.
// Body: { productName, quantity, quantityUnit, rateInr, tagNumber?, notes? }
router.post('/:inquiryId/items', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const { productName, quantity, quantityUnit, rateInr, tagNumber, mocType, notes, remarks } = req.body as {
      productName:   string;
      quantity:      number;
      quantityUnit?: string;
      rateInr:       number;
      tagNumber?:    string;
      mocType?:          string;
      notes?:        string;
      remarks?:      string;
    };

    if (!productName?.trim()) {
      res.status(400).json({ error: 'productName is required.' });
      return;
    }
    if (typeof quantity !== 'number' || quantity < 0) {
      res.status(400).json({ error: 'quantity must be a non-negative number.' });
      return;
    }
    if (typeof rateInr !== 'number' || rateInr < 0) {
      res.status(400).json({ error: 'rateInr must be a non-negative number.' });
      return;
    }

    let work = await Stage7Work.findOne({ inquiryId });
    if (!work) {
      work = new Stage7Work({ inquiryId, status: 'done' });
    }

    work.items.push({
      _id:          new mongoose.Types.ObjectId(),
      tagNumber:    (tagNumber ?? '').trim(),
      productName:  productName.trim(),
      quantity,
      quantityUnit: (quantityUnit ?? 'nos').trim(),
      rateInr,
      totalInr:     Math.round(rateInr * quantity),
      aiEstimated:  false,
      rationale:    '',
      confidence:   'manual',
      mocType:          (mocType ?? '').trim(),
      notes:        (notes ?? '').trim(),
      remarks:      (remarks ?? '').trim(),
    });

    recompute(work);
    await work.save();

    res.status(201).json(formatBom(work));
  } catch (err) {
    console.error('[stage7] add item error:', err);
    res.status(500).json({ error: 'Failed to add item.', details: String(err) });
  }
});

// ─── PATCH /api/stage7/:inquiryId/items/:itemId ───────────────────────────────
// Update a single BOM item. Recalculates totalInr and grandTotalInr automatically.
// Body: any subset of { productName, quantity, quantityUnit, rateInr, tagNumber, notes }
router.patch('/:inquiryId/items/:itemId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    if (!mongoose.Types.ObjectId.isValid(req.params.itemId)) {
      res.status(400).json({ error: 'Invalid item id.' });
      return;
    }

    const work = await Stage7Work.findOne({ inquiryId });
    if (!work) {
      res.status(404).json({ error: 'BOM not found for this inquiry.' });
      return;
    }

    const item = (work.items as IBomItem[]).find(i => String(i._id) === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'BOM item not found.' });
      return;
    }

    const { productName, quantity, quantityUnit, rateInr, tagNumber, mocType, notes, remarks } = req.body as {
      productName?:  string;
      quantity?:     number;
      quantityUnit?: string;
      rateInr?:      number;
      tagNumber?:    string;
      mocType?:          string;
      notes?:        string;
      remarks?:      string;
    };

    if (productName  !== undefined) item.productName  = productName.trim();
    if (tagNumber    !== undefined) item.tagNumber    = tagNumber.trim();
    if (quantityUnit !== undefined) item.quantityUnit = quantityUnit.trim();
    if (mocType          !== undefined) item.mocType          = mocType.trim();
    if (notes        !== undefined) item.notes        = notes.trim();
    if (remarks      !== undefined) item.remarks      = remarks.trim();

    if (quantity !== undefined) {
      if (typeof quantity !== 'number' || quantity < 0) {
        res.status(400).json({ error: 'quantity must be a non-negative number.' });
        return;
      }
      item.quantity = quantity;
    }

    if (rateInr !== undefined) {
      if (typeof rateInr !== 'number' || rateInr < 0) {
        res.status(400).json({ error: 'rateInr must be a non-negative number.' });
        return;
      }
      item.rateInr     = rateInr;
      item.aiEstimated = false;
      item.confidence  = 'manual';
    }

    recompute(work);
    await work.save();

    res.json(formatBom(work));
  } catch (err) {
    console.error('[stage7] patch item error:', err);
    res.status(500).json({ error: 'Failed to update item.', details: String(err) });
  }
});

// ─── DELETE /api/stage7/:inquiryId/items/:itemId ──────────────────────────────
// Remove a line item from the BOM.
router.delete('/:inquiryId/items/:itemId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    if (!mongoose.Types.ObjectId.isValid(req.params.itemId)) {
      res.status(400).json({ error: 'Invalid item id.' });
      return;
    }

    const work = await Stage7Work.findOne({ inquiryId });
    if (!work) {
      res.status(404).json({ error: 'BOM not found for this inquiry.' });
      return;
    }

    const exists = (work.items as IBomItem[]).some(i => String(i._id) === req.params.itemId);
    if (!exists) {
      res.status(404).json({ error: 'BOM item not found.' });
      return;
    }

    (work.items as mongoose.Types.DocumentArray<IBomItem>).pull({ _id: req.params.itemId });
    recompute(work);
    await work.save();

    res.json(formatBom(work));
  } catch (err) {
    console.error('[stage7] delete item error:', err);
    res.status(500).json({ error: 'Failed to delete item.', details: String(err) });
  }
});

export default router;
