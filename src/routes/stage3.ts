import { Router, Request, Response } from 'express';
import { Stage3Work }  from '../models/Stage3Work';
import { Section }     from '../models/Section';
import { Inquiry }     from '../models/Inquiry';
import { analyseGaps, draftEmail } from '../services/stage3';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreate(inquiryId: string) {
  return Stage3Work.findOneAndUpdate(
    { inquiryId },
    { $setOnInsert: { inquiryId } },
    { upsert: true, new: true },
  );
}

async function requireInquiry(inquiryId: string, res: Response) {
  const inquiry = await Inquiry.findOne({ inquiryId }).lean();
  if (!inquiry) {
    res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
    return null;
  }
  return inquiry;
}

// ─── GET /api/stage3/:inquiryId ───────────────────────────────────────────────
// Returns all stage 3 work (gap analysis + email draft) for an inquiry.
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage3Work.findOne({ inquiryId }).lean();
    if (!work) {
      res.json({ inquiryId, gapAnalysis: null, emailDraft: null });
      return;
    }
    res.json(work);
  } catch (err) {
    console.error('[stage3] get error:', err);
    res.status(500).json({ error: 'Failed to fetch stage 3 work.' });
  }
});

// ─── POST /api/stage3/:inquiryId/analyse ─────────────────────────────────────
// Run Gemini gap analysis on all sections extracted for this inquiry.
// Synchronous — responds with the result directly.
router.post('/:inquiryId/analyse', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const inquiry = await requireInquiry(inquiryId, res);
    if (!inquiry) return;

    const work = await getOrCreate(inquiryId);
    if (work.gapAnalysis.status === 'processing') {
      res.status(409).json({ error: 'Analysis already in progress.' });
      return;
    }

    // Mark processing
    work.gapAnalysis.status = 'processing';
    work.gapAnalysis.error  = '';
    await work.save();

    // Fetch all extracted sections for this inquiry
    const sections = await Section.find({ inquiryId })
      .sort({ documentId: 1, sectionIndex: 1 })
      .lean();

    const scope  = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;

    const result = await analyseGaps(
      inquiryId,
      scope,
      inquiry.client,
      sections.map(s => ({
        docType:       s.docType,
        documentTitle: s.documentTitle,
        title:         s.title,
        summary:       s.summary,
      })),
    );

    work.gapAnalysis = {
      status:           'done',
      error:            '',
      requiredSections: result.requiredSections,
      receivedSections: result.receivedSections,
      gaps:             result.gaps,
      recommendation:   result.recommendation,
      analysedAt:       new Date(),
    };
    await work.save();

    res.json(work.gapAnalysis);
  } catch (err) {
    console.error('[stage3] analyse error:', err);

    // Persist failure
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage3Work.findOne({ inquiryId });
      if (work) {
        work.gapAnalysis.status = 'failed';
        work.gapAnalysis.error  = String(err);
        await work.save();
      }
    } catch { /* ignore secondary error */ }

    res.status(500).json({ error: 'Gap analysis failed.', details: String(err) });
  }
});

// ─── GET /api/stage3/:inquiryId/analyse ──────────────────────────────────────
// Retrieve saved gap analysis result.
router.get('/:inquiryId/analyse', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage3Work.findOne({ inquiryId }).lean();
    if (!work || work.gapAnalysis.status === 'pending') {
      res.status(404).json({ error: 'No gap analysis found. Run POST /analyse first.' });
      return;
    }
    res.json(work.gapAnalysis);
  } catch (err) {
    console.error('[stage3] get analyse error:', err);
    res.status(500).json({ error: 'Failed to fetch gap analysis.' });
  }
});

// ─── POST /api/stage3/:inquiryId/email ───────────────────────────────────────
// Draft acknowledgment email using gap analysis results.
// Will re-run gap analysis if not yet done.
router.post('/:inquiryId/email', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const inquiry = await requireInquiry(inquiryId, res);
    if (!inquiry) return;

    const work = await getOrCreate(inquiryId);

    // Need gap analysis to draft the email — run it now if missing
    let gapResult = work.gapAnalysis.status === 'done' ? work.gapAnalysis : null;

    if (!gapResult) {
      const sections = await Section.find({ inquiryId })
        .sort({ documentId: 1, sectionIndex: 1 })
        .lean();

      const scope = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;

      const analysed = await analyseGaps(
        inquiryId,
        scope,
        inquiry.client,
        sections.map(s => ({
          docType:       s.docType,
          documentTitle: s.documentTitle,
          title:         s.title,
          summary:       s.summary,
        })),
      );

      work.gapAnalysis = {
        status:           'done',
        error:            '',
        requiredSections: analysed.requiredSections,
        receivedSections: analysed.receivedSections,
        gaps:             analysed.gaps,
        recommendation:   analysed.recommendation,
        analysedAt:       new Date(),
      };
      await work.save();
      gapResult = work.gapAnalysis;
    }

    // Draft email
    work.emailDraft.status = 'processing';
    work.emailDraft.error  = '';
    await work.save();

    const email = await draftEmail(
      inquiryId,
      inquiry.scope,
      inquiry.client,
      inquiry.project,
      gapResult,
    );

    work.emailDraft = {
      status:    'done',
      error:     '',
      subject:   email.subject,
      body:      email.body,
      draftedAt: new Date(),
    };
    await work.save();

    res.json(work.emailDraft);
  } catch (err) {
    console.error('[stage3] email error:', err);

    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage3Work.findOne({ inquiryId });
      if (work) {
        work.emailDraft.status = 'failed';
        work.emailDraft.error  = String(err);
        await work.save();
      }
    } catch { /* ignore */ }

    res.status(500).json({ error: 'Email draft failed.', details: String(err) });
  }
});

// ─── GET /api/stage3/:inquiryId/email ────────────────────────────────────────
// Retrieve saved email draft.
router.get('/:inquiryId/email', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage3Work.findOne({ inquiryId }).lean();
    if (!work || work.emailDraft.status === 'pending') {
      res.status(404).json({ error: 'No email draft found. Run POST /email first.' });
      return;
    }
    res.json(work.emailDraft);
  } catch (err) {
    console.error('[stage3] get email error:', err);
    res.status(500).json({ error: 'Failed to fetch email draft.' });
  }
});

export default router;
