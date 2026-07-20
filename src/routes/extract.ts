import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Doc } from '../models/Document';
import { Section } from '../models/Section';
import { Inquiry } from '../models/Inquiry';
import { downloadFromS3 } from '../s3';
import { extractDocument } from '../services/gemini';
import { logger } from '../logger';

const router = Router();

// ─── Background pipeline ──────────────────────────────────────────────────────

async function runPipeline(docId: string): Promise<void> {
  const doc = await Doc.findById(docId);
  if (!doc || !doc.s3Key) return;

  try {
    doc.processingStatus = 'processing';
    doc.processingError  = '';
    await doc.save();

    // 1. Download file from S3, convert to base64, then drop the buffer
    //    so it can be GC'd before the Gemini network call begins
    let buffer: Buffer | null = await downloadFromS3(doc.s3Key);
    const base64Data = buffer.toString('base64');
    buffer = null;

    // 2. Resolve inquiry scope for a richer Gemini prompt
    const inquiry = await Inquiry.findOne({ inquiryId: doc.inquiryId }).lean();
    const scope   = inquiry
      ? `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`
      : doc.inquiryId;

    // 3. Single Gemini call: extract + summarise
    const result = await extractDocument(
      base64Data,
      doc.mimeType || 'application/pdf',
      doc.docType,
      scope,
      doc.inquiryId,
    );

    // 4. Persist results into Document
    doc.aiSummary         = result.overview;
    doc.keyItems          = result.keyItems;
    doc.extractedSections = result.sections.map(s => ({
      title:   s.title,
      content: s.content,
      summary: s.summary,
    }));
    doc.processingStatus = 'done';
    await doc.save();

    // 5. Upsert sections into the Section collection
    //    Delete stale sections from a previous extraction run first.
    await Section.deleteMany({ documentId: new mongoose.Types.ObjectId(docId) });

    if (result.sections.length > 0) {
      await Section.insertMany(
        result.sections.map((s, i) => ({
          inquiryId:     doc.inquiryId,
          documentId:    doc._id,
          docType:       doc.docType,
          documentTitle: doc.title,
          sectionIndex:  i,
          title:         s.title,
          content:       s.content,
          summary:       s.summary,
        })),
      );
    }

    logger.info(
      `[extract] ✓ ${doc.docType} — ${doc.title} (${doc.inquiryId}) ` +
      `| ${result.sections.length} sections saved`,
    );
  } catch (err) {
    doc.processingStatus = 'failed';
    doc.processingError  = String(err);
    await doc.save();
    logger.error(`[extract] ✗ ${docId}:`, err);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/extract/document/:docId
// Triggers Gemini extraction for one document. Responds 202, processes async.
router.post('/document/:docId', async (req: Request, res: Response) => {
  const doc = await Doc.findById(req.params.docId).lean();

  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  if (!doc.s3Key) {
    res.status(400).json({
      error: 'No file uploaded for this document. Upload a file before extracting.',
    });
    return;
  }
  if (doc.processingStatus === 'processing') {
    res.status(409).json({ error: 'Extraction already in progress.' });
    return;
  }

  res.status(202).json({
    message:   'Extraction started.',
    docId:     doc._id,
    statusUrl: `/api/extract/document/${doc._id}`,
  });

  runPipeline(String(doc._id)).catch(err => logger.error('[extract] pipeline failed', err));
});

// GET /api/extract/document/:docId
// Poll for extraction results.
router.get('/document/:docId', async (req: Request, res: Response) => {
  const doc = await Doc.findById(req.params.docId)
    .select(
      'inquiryId docType title processingStatus processingError ' +
      'aiSummary keyItems extractedSections updatedAt'
    )
    .lean();

  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }

  res.json(doc);
});

// POST /api/extract/inquiry/:inquiryId
// Synchronously extracts all uploaded-but-unprocessed documents for an inquiry.
// Awaits Gemini for every document and returns the full results.
router.post('/inquiry/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const force = req.query.force === 'true';
    const statusFilter = force
      ? { $in: ['pending', 'processing', 'done', 'failed'] }
      : { $in: ['pending', 'failed'] };

    const pending = await Doc.find({
      inquiryId,
      s3Key:            { $ne: '' },
      processingStatus: statusFilter,
    }).lean();

    if (!force && pending.length === 0) {
      const docs = await Doc.find({ inquiryId, s3Key: { $ne: '' } })
        .select('docType title processingStatus processingError aiSummary keyItems extractedSections')
        .lean();
      res.json({ message: 'All documents already extracted.', processed: 0, documents: docs });
      return;
    }

    if (pending.length === 0) {
      res.json({ message: 'No uploaded documents found.', processed: 0, documents: [] });
      return;
    }

    // Reset status so runPipeline picks them up fresh (needed for force re-extract)
    if (force) {
      await Doc.updateMany(
        { _id: { $in: pending.map(d => d._id) } },
        { $set: { processingStatus: 'pending', processingError: '' } },
      );
    }

    // Run sequentially to avoid holding multiple PDF buffers in memory at once
    for (const doc of pending) {
      await runPipeline(String(doc._id));
    }

    // Return updated documents with extraction results
    const docs = await Doc.find({ inquiryId, s3Key: { $ne: '' } })
      .select('docType title processingStatus processingError aiSummary keyItems extractedSections')
      .lean();

    res.json({
      message:   `Extracted ${pending.length} document(s).`,
      processed: pending.length,
      documents: docs,
    });
  } catch (err) {
    logger.error('[extract] inquiry error:', err);
    res.status(500).json({ error: 'Extraction failed.', details: String(err) });
  }
});

// GET /api/extract/inquiry/:inquiryId
// Status overview for all documents of an inquiry.
router.get('/inquiry/:inquiryId', async (req: Request, res: Response) => {
  const inquiryId = decodeURIComponent(req.params.inquiryId);

  const docs = await Doc.find({ inquiryId })
    .select('docType title s3Key processingStatus processingError aiSummary keyItems')
    .lean();

  res.json({
    total:     docs.length,
    uploaded:  docs.filter(d => d.s3Key).length,
    done:      docs.filter(d => d.processingStatus === 'done').length,
    processing:docs.filter(d => d.processingStatus === 'processing').length,
    failed:    docs.filter(d => d.processingStatus === 'failed').length,
    pending:   docs.filter(d => d.processingStatus === 'pending').length,
    documents: docs,
  });
});

export default router;
