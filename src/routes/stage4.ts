import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Stage4Work } from '../models/Stage4Work';
import { Doc }        from '../models/Document';
import { Inquiry }    from '../models/Inquiry';
import { downloadFromS3 } from '../s3';
import { extractTagList } from '../services/stage4';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getOrCreate(inquiryId: string) {
  return Stage4Work.findOneAndUpdate(
    { inquiryId },
    { $setOnInsert: { inquiryId } },
    { upsert: true, new: true },
  );
}

// ─── POST /api/stage4/:inquiryId/extract ─────────────────────────────────────
// Body: { documentId: string }  — which document to extract tag list from.
// Synchronous — downloads the PDF, calls Gemini, saves and returns the result.
router.post('/:inquiryId/extract', async (req: Request, res: Response) => {
  try {
    const inquiryId   = decodeURIComponent(req.params.inquiryId);
    const { documentId } = req.body as { documentId?: string };

    // ── Resolve inquiry ──────────────────────────────────────────────────────
    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: `Inquiry ${inquiryId} not found.` });
      return;
    }

    // ── Resolve document ─────────────────────────────────────────────────────
    let doc;

    if (documentId) {
      if (!mongoose.Types.ObjectId.isValid(documentId)) {
        res.status(400).json({ error: 'Invalid documentId.' });
        return;
      }
      doc = await Doc.findById(documentId);
      if (!doc || doc.inquiryId !== inquiryId) {
        res.status(404).json({ error: 'Document not found for this inquiry.' });
        return;
      }
    } else {
      // Fall back to the first document with a file for this inquiry
      doc = await Doc.findOne({ inquiryId, s3Key: { $exists: true, $ne: '' } });
      if (!doc) {
        res.status(422).json({ error: 'No uploaded document found for this inquiry. Please provide a documentId.' });
        return;
      }
    }

    if (!doc.s3Key) {
      res.status(422).json({ error: 'Document has no file attached yet.' });
      return;
    }

    // ── Download + extract (no intermediate processing state) ────────────────
    const documentTitle = doc.title || doc.fileName;
    const scope         = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;
    const buffer        = await downloadFromS3(doc.s3Key);

    const result = await extractTagList(
      buffer,
      doc.mimeType || 'application/pdf',
      inquiryId,
      documentTitle,
      scope,
    );

    // ── Save results ─────────────────────────────────────────────────────────
    const work = await getOrCreate(inquiryId);
    work.sourceDocumentId    = doc._id as mongoose.Types.ObjectId;
    work.sourceDocumentTitle = documentTitle;
    work.tags                = result.tags;
    work.extractionMeta      = result.extractionMeta;
    work.extractionNotes     = result.extractionNotes;
    work.status              = 'done';
    work.error               = '';
    work.extractedAt         = new Date();
    await work.save();

    res.json({
      inquiryId,
      sourceDocumentId:    String(work.sourceDocumentId),
      sourceDocumentTitle: work.sourceDocumentTitle,
      status:              work.status,
      extractedAt:         work.extractedAt,
      extractionNotes:     work.extractionNotes,
      extractionMeta:      work.extractionMeta,
      tags:                work.tags,
    });
  } catch (err) {
    console.error('[stage4] extract error:', err);

    // Persist failure
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage4Work.findOne({ inquiryId });
      if (work) {
        work.status = 'failed';
        work.error  = String(err);
        await work.save();
      }
    } catch { /* ignore secondary error */ }

    res.status(500).json({ error: 'Tag list extraction failed.', details: String(err) });
  }
});

// ─── GET /api/stage4/:inquiryId ───────────────────────────────────────────────
// Returns the saved Stage 4 result (tags + status) for an inquiry.
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage4Work.findOne({ inquiryId }).lean();

    if (!work) {
      res.json({
        inquiryId,
        status:  'pending',
        tags:    [],
        extractionNotes: '',
        sourceDocumentId:    null,
        sourceDocumentTitle: '',
        extractedAt:         null,
      });
      return;
    }

    res.json({
      inquiryId,
      sourceDocumentId:    work.sourceDocumentId ? String(work.sourceDocumentId) : null,
      sourceDocumentTitle: work.sourceDocumentTitle,
      status:              work.status,
      error:               work.error || undefined,
      extractedAt:         work.extractedAt,
      extractionNotes:     work.extractionNotes,
      extractionMeta:      work.extractionMeta,
      tags:                work.tags,
    });
  } catch (err) {
    console.error('[stage4] get error:', err);
    res.status(500).json({ error: 'Failed to fetch Stage 4 work.' });
  }
});

// ─── GET /api/stage4/:inquiryId/tags ─────────────────────────────────────────
// Returns just the tags array for lightweight table rendering.
router.get('/:inquiryId/tags', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage4Work.findOne({ inquiryId }, { tags: 1, status: 1 }).lean();

    if (!work || work.status !== 'done') {
      res.status(work?.status === 'failed' ? 500 : 404).json({
        error: work?.status === 'failed'
          ? 'Extraction failed — re-run POST /extract.'
          : 'No extraction result yet. Run POST /extract first.',
      });
      return;
    }

    res.json({ inquiryId, count: work.tags.length, tags: work.tags });
  } catch (err) {
    console.error('[stage4] tags error:', err);
    res.status(500).json({ error: 'Failed to fetch tags.' });
  }
});

export default router;
