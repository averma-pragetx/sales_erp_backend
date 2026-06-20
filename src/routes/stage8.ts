import { Router, Request, Response } from 'express';
import { Stage8Work } from '../models/Stage8Work';
import { Inquiry }    from '../models/Inquiry';
import { draftProposal } from '../services/stage8';

const router = Router();

// ─── GET /api/stage8/:inquiryId ───────────────────────────────────────────────
// Returns saved proposal (title + body + status). Returns pending skeleton if none exists.
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage8Work.findOne({ inquiryId }).lean();

    if (!work) {
      res.json({ inquiryId, status: 'pending', title: '', body: '', draftedAt: null, editedAt: null });
      return;
    }

    res.json({
      inquiryId:  work.inquiryId,
      status:     work.status,
      error:      work.error || undefined,
      title:      work.title,
      body:       work.body,
      draftedAt:  work.draftedAt,
      editedAt:   work.editedAt,
    });
  } catch (err) {
    console.error('[stage8] get error:', err);
    res.status(500).json({ error: 'Failed to fetch proposal.' });
  }
});

// ─── POST /api/stage8/:inquiryId/draft ────────────────────────────────────────
// Generate (or regenerate) the techno-commercial proposal using Gemini.
// Aggregates data from all prior stages, builds a comprehensive prompt,
// and saves the resulting Markdown proposal to MongoDB.
// Synchronous — responds with the full proposal directly.
// Re-running REPLACES the existing draft.
router.post('/:inquiryId/draft', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    // Verify inquiry exists
    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
      return;
    }

    // Guard against concurrent runs
    let work = await Stage8Work.findOne({ inquiryId });
    if (work?.status === 'processing') {
      res.status(409).json({ error: 'Proposal draft already in progress.' });
      return;
    }

    if (!work) {
      work = new Stage8Work({ inquiryId });
    }

    work.status = 'processing';
    work.error  = '';
    await work.save();

    // Call the service — this gathers all stage data and runs Gemini
    const result = await draftProposal(inquiryId);

    work.title     = result.title;
    work.body      = result.body;
    work.status    = 'done';
    work.draftedAt = new Date();
    work.editedAt  = null;
    await work.save();

    res.json({
      inquiryId:  work.inquiryId,
      status:     work.status,
      title:      work.title,
      body:       work.body,
      draftedAt:  work.draftedAt,
      editedAt:   work.editedAt,
    });
  } catch (err) {
    console.error('[stage8] draft error:', err);

    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage8Work.findOne({ inquiryId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }

    res.status(500).json({ error: 'Proposal generation failed.', details: String(err) });
  }
});

// ─── PATCH /api/stage8/:inquiryId ─────────────────────────────────────────────
// Manually edit the proposal title and/or body after generation.
// Body: { title?, body? }
// Sets editedAt timestamp to indicate manual modification.
router.patch('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const work = await Stage8Work.findOne({ inquiryId });
    if (!work) {
      res.status(404).json({ error: 'No proposal found. Run POST /draft first.' });
      return;
    }

    if (work.status === 'processing') {
      res.status(409).json({ error: 'Cannot edit while generation is in progress.' });
      return;
    }

    const { title, body } = req.body as { title?: string; body?: string };

    if (title !== undefined) work.title = title.trim();
    if (body  !== undefined) work.body  = body.trim();

    if (title !== undefined || body !== undefined) {
      work.editedAt = new Date();
      if (work.status !== 'done') work.status = 'done';
    }

    await work.save();

    res.json({
      inquiryId:  work.inquiryId,
      status:     work.status,
      title:      work.title,
      body:       work.body,
      draftedAt:  work.draftedAt,
      editedAt:   work.editedAt,
    });
  } catch (err) {
    console.error('[stage8] patch error:', err);
    res.status(500).json({ error: 'Failed to update proposal.', details: String(err) });
  }
});

export default router;
