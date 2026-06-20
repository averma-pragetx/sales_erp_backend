import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { TechQuery } from '../models/TechQuery';
import { Inquiry }   from '../models/Inquiry';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(tqs: { status: string }[]) {
  const draft    = tqs.filter(t => t.status === 'draft').length;
  const sent     = tqs.filter(t => t.status === 'sent').length;
  const answered = tqs.filter(t => t.status === 'answered').length;

  let stageState = 'No queries raised';
  if (tqs.length > 0) {
    if (sent > 0)          stageState = 'Waiting on client';
    else if (draft > 0)    stageState = 'Drafts pending review';
    else if (answered === tqs.length) stageState = 'All queries answered';
  }

  return { total: tqs.length, draft, sent, answered, stageState };
}

async function nextTqIndex(inquiryId: string): Promise<{ tqIndex: number; tqNumber: string }> {
  const last = await TechQuery.findOne({ inquiryId }).sort({ tqIndex: -1 }).lean();
  const tqIndex  = last ? last.tqIndex + 1 : 1;
  const tqNumber = `TQ-${String(tqIndex).padStart(2, '0')}`;
  return { tqIndex, tqNumber };
}

// ─── GET /api/stage6/:inquiryId ───────────────────────────────────────────────
// All TQs for an inquiry + summary stats.
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const tqs = await TechQuery.find({ inquiryId }).sort({ tqIndex: 1 }).lean();
    res.json({ inquiryId, summary: buildSummary(tqs), tqs });
  } catch (err) {
    console.error('[stage6] list error:', err);
    res.status(500).json({ error: 'Failed to fetch tech queries.' });
  }
});

// ─── POST /api/stage6/:inquiryId/tq ──────────────────────────────────────────
// Create a new TQ. Auto-assigns TQ number.
// Body: { tagClause, clauseRef, question, sendTo, raisedBy }
router.post('/:inquiryId/tq', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
      return;
    }

    const { tagClause, clauseRef, question, sendTo, raisedBy } = req.body as {
      tagClause?: string;
      clauseRef?: string;
      question:   string;
      sendTo:     string;
      raisedBy:   string;
    };

    if (!question?.trim()) {
      res.status(400).json({ error: 'question is required.' });
      return;
    }
    if (!sendTo?.trim()) {
      res.status(400).json({ error: 'sendTo is required.' });
      return;
    }
    if (!raisedBy?.trim()) {
      res.status(400).json({ error: 'raisedBy is required.' });
      return;
    }

    const { tqIndex, tqNumber } = await nextTqIndex(inquiryId);

    const tq = await TechQuery.create({
      inquiryId,
      tqIndex,
      tqNumber,
      tagClause:  tagClause?.trim() || '–',
      clauseRef:  clauseRef?.trim() || '',
      question:   question.trim(),
      sendTo:     sendTo.trim(),
      raisedBy:   raisedBy.trim(),
      status:     'draft',
    });

    res.status(201).json(tq);
  } catch (err) {
    console.error('[stage6] create error:', err);
    res.status(500).json({ error: 'Failed to create tech query.', details: String(err) });
  }
});

// ─── GET /api/stage6/:inquiryId/tq/:tqId ─────────────────────────────────────
// Single TQ by its MongoDB ObjectId.
router.get('/:inquiryId/tq/:tqId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.tqId)) {
      res.status(400).json({ error: 'Invalid TQ id.' });
      return;
    }
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const tq = await TechQuery.findOne({ _id: req.params.tqId, inquiryId }).lean();
    if (!tq) {
      res.status(404).json({ error: 'Tech query not found.' });
      return;
    }
    res.json(tq);
  } catch (err) {
    console.error('[stage6] get tq error:', err);
    res.status(500).json({ error: 'Failed to fetch tech query.' });
  }
});

// ─── PATCH /api/stage6/:inquiryId/tq/:tqId ───────────────────────────────────
// Update editable fields and / or advance status.
// Accepted body keys (all optional):
//   tagClause, clauseRef, question, answer, sendTo, raisedBy, status
//
// Status rules enforced:
//   draft  → sent      (sets sentAt)
//   sent   → answered  (sets answeredAt; answer text must be present)
//   No backward transitions.
router.patch('/:inquiryId/tq/:tqId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.tqId)) {
      res.status(400).json({ error: 'Invalid TQ id.' });
      return;
    }
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const tq = await TechQuery.findOne({ _id: req.params.tqId, inquiryId });
    if (!tq) {
      res.status(404).json({ error: 'Tech query not found.' });
      return;
    }

    const { tagClause, clauseRef, question, answer, sendTo, raisedBy, status } = req.body as {
      tagClause?:  string;
      clauseRef?:  string;
      question?:   string;
      answer?:     string;
      sendTo?:     string;
      raisedBy?:   string;
      status?:     string;
    };

    // Apply field edits (only when not yet answered — lock answered TQs from question edits)
    if (tq.status !== 'answered') {
      if (tagClause !== undefined) tq.tagClause = tagClause.trim() || '–';
      if (clauseRef !== undefined) tq.clauseRef = clauseRef.trim();
      if (question  !== undefined) tq.question  = question.trim();
      if (sendTo    !== undefined) tq.sendTo    = sendTo.trim();
      if (raisedBy  !== undefined) tq.raisedBy  = raisedBy.trim();
    }

    // Answer can be set/updated even after answered (for corrections)
    if (answer !== undefined) tq.answer = answer.trim();

    // Status advancement
    if (status && status !== tq.status) {
      const ORDER = { draft: 0, sent: 1, answered: 2 };
      const currentRank = ORDER[tq.status as keyof typeof ORDER] ?? 0;
      const newRank     = ORDER[status as keyof typeof ORDER];

      if (newRank === undefined) {
        res.status(400).json({ error: `Invalid status "${status}". Must be draft | sent | answered.` });
        return;
      }
      if (newRank < currentRank) {
        res.status(400).json({ error: `Cannot move status backwards (${tq.status} → ${status}).` });
        return;
      }
      if (status === 'answered' && !tq.answer?.trim()) {
        res.status(400).json({ error: 'Provide an answer before marking as answered.' });
        return;
      }

      tq.status = status as 'draft' | 'sent' | 'answered';
      if (status === 'sent'     && !tq.sentAt)     tq.sentAt     = new Date();
      if (status === 'answered' && !tq.answeredAt) tq.answeredAt = new Date();
    }

    await tq.save();
    res.json(tq);
  } catch (err) {
    console.error('[stage6] patch error:', err);
    res.status(500).json({ error: 'Failed to update tech query.', details: String(err) });
  }
});

// ─── DELETE /api/stage6/:inquiryId/tq/:tqId ──────────────────────────────────
// Remove a TQ. TQ numbers are not re-sequenced (gaps are normal in a TQ log).
router.delete('/:inquiryId/tq/:tqId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.tqId)) {
      res.status(400).json({ error: 'Invalid TQ id.' });
      return;
    }
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const tq = await TechQuery.findOneAndDelete({ _id: req.params.tqId, inquiryId });
    if (!tq) {
      res.status(404).json({ error: 'Tech query not found.' });
      return;
    }

    res.json({ message: `${tq.tqNumber} deleted.`, tqId: req.params.tqId });
  } catch (err) {
    console.error('[stage6] delete error:', err);
    res.status(500).json({ error: 'Failed to delete tech query.' });
  }
});

export default router;
