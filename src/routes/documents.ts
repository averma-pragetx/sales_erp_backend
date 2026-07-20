import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Doc } from '../models/Document';
import { uploadToS3, getPresignedUrl } from '../s3';
import { logger } from '../logger';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── Field sets ───────────────────────────────────────────────────────────────
// s3Key / s3Bucket are internal storage details — never sent to the client.
// The client gets a short-lived presignedUrl instead.

const PUBLIC_FIELDS =
  '_id inquiryId docType title rev status ' +
  'fileName fileSize mimeType uploadedBy ' +
  'processingStatus processingError aiSummary keyItems extractedSections ' +
  'createdAt updatedAt';

const ANALYSIS_FIELDS =
  '_id inquiryId docType title processingStatus processingError ' +
  'aiSummary keyItems extractedSections updatedAt';

// Attach a presigned download URL (null if no file uploaded yet)
async function withPresignedUrl<T extends { s3Key?: string }>(
  doc: T,
): Promise<T & { presignedUrl: string | null; hasFile: boolean }> {
  let presignedUrl: string | null = null;
  if (doc.s3Key) {
    try { presignedUrl = await getPresignedUrl(doc.s3Key); } catch { /* leave null */ }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { s3Key: _s3Key, ...rest } = doc as T & { s3Key: string };
  return { ...rest as T, presignedUrl, hasFile: !!doc.s3Key };
}

// ─── List documents for an inquiry (with AI fields + presigned URLs) ──────────
router.get('/inquiry/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const docs = await Doc.find({ inquiryId })
      .select(PUBLIC_FIELDS + ' s3Key')   // fetch s3Key for URL generation, strip before send
      .sort({ createdAt: -1 })
      .lean();

    const result = await Promise.all(docs.map(withPresignedUrl));
    res.json(result);
  } catch (err) {
    logger.error('[documents] list error:', err);
    res.status(500).json({ error: 'Failed to fetch documents.' });
  }
});

// ─── Single document (full public fields + presigned URL) ─────────────────────
router.get('/:docId', async (req: Request, res: Response) => {
  try {
    const doc = await Doc.findById(req.params.docId)
      .select(PUBLIC_FIELDS + ' s3Key')
      .lean();
    if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }

    const result = await withPresignedUrl(doc);
    res.json(result);
  } catch (err) {
    logger.error('[documents] get error:', err);
    res.status(500).json({ error: 'Failed to fetch document.' });
  }
});

// ─── AI analysis for a single document ───────────────────────────────────────
// Returns only the Gemini-derived fields. The frontend calls this to render
// the summary panel — no raw storage details, no internal keys.
router.get('/:docId/analysis', async (req: Request, res: Response) => {
  try {
    const doc = await Doc.findById(req.params.docId)
      .select(ANALYSIS_FIELDS)
      .lean();
    if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }

    res.json({
      docId:            doc._id,
      inquiryId:        doc.inquiryId,
      docType:          doc.docType,
      title:            doc.title,
      processingStatus: doc.processingStatus,
      processingError:  doc.processingStatus === 'failed' ? doc.processingError : undefined,
      analysis: doc.processingStatus === 'done'
        ? {
            overview:  doc.aiSummary,
            keyItems:  doc.keyItems,
            sections:  doc.extractedSections,
          }
        : null,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    logger.error('[documents] analysis error:', err);
    res.status(500).json({ error: 'Failed to fetch analysis.' });
  }
});

// ─── Upload new document ──────────────────────────────────────────────────────
router.post(
  '/inquiry/:inquiryId',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const { docType, title, rev, status } = req.body as {
        docType: string; title: string; rev: string; status: 'read' | 'open' | 'queued';
      };

      if (!docType || !title || !rev || !status) {
        res.status(400).json({ error: 'docType, title, rev, and status are required.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'File is required.' });
        return;
      }

      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const s3Key = `inquiries/${inquiryId}/${Date.now()}-${sanitizedName}`;
      await uploadToS3(s3Key, req.file.buffer, req.file.mimetype);

      const doc = await new Doc({
        inquiryId,
        docType,
        title,
        rev,
        status,
        s3Key,
        fileName:   req.file.originalname,
        fileSize:   req.file.size,
        mimeType:   req.file.mimetype,
        uploadedBy: 'system',
      }).save();

      const presignedUrl = await getPresignedUrl(s3Key);

      // Return public fields + presigned URL (strip s3Key)
      const { s3Key: _k, ...publicDoc } = doc.toObject();
      res.status(201).json({ ...publicDoc, presignedUrl, hasFile: true });
    } catch (err) {
      logger.error('[documents] upload error:', err);
      res.status(500).json({ error: 'Failed to upload document.' });
    }
  },
);

// ─── Delete document ──────────────────────────────────────────────────────────
router.delete('/:docId', async (req: Request, res: Response) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.docId);
    if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }
    res.json({ message: 'Document deleted.' });
  } catch (err) {
    logger.error('[documents] delete error:', err);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

export default router;
