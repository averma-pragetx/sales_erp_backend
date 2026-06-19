import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Doc } from '../models/Document';
import { uploadToS3, getPresignedUrl } from '../s3';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// GET /inquiry/:inquiryId — list all docs for an inquiry
router.get('/inquiry/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const docs = await Doc.find({ inquiryId }).lean().sort({ createdAt: -1 });

    const docsWithUrls = await Promise.all(
      docs.map(async (doc) => {
        if (doc.s3Key) {
          try {
            const presignedUrl = await getPresignedUrl(doc.s3Key);
            return { ...doc, presignedUrl };
          } catch {
            return { ...doc, presignedUrl: null };
          }
        }
        return { ...doc, presignedUrl: null };
      })
    );

    res.json(docsWithUrls);
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// POST /inquiry/:inquiryId — upload a new document
router.post(
  '/inquiry/:inquiryId',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const { docType, title, rev, status } = req.body as {
        docType: string;
        title: string;
        rev: string;
        status: 'read' | 'open' | 'queued';
      };

      if (!docType || !title || !rev || !status) {
        res.status(400).json({ error: 'docType, title, rev, and status are required' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'File is required' });
        return;
      }

      const sanitizedName = req.file.originalname.replace(/\s+/g, '_');
      const s3Key = `inquiries/${inquiryId}/${Date.now()}-${sanitizedName}`;

      await uploadToS3(s3Key, req.file.buffer, req.file.mimetype);

      const bucket = process.env.AWS_S3_BUCKET ?? '';

      const doc = new Doc({
        inquiryId,
        docType,
        title,
        rev,
        status,
        s3Key,
        s3Bucket: bucket,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        uploadedBy: 'system',
      });

      const saved = await doc.save();
      const presignedUrl = await getPresignedUrl(s3Key);

      res.status(201).json({ ...saved.toObject(), presignedUrl });
    } catch (error) {
      console.error('Error uploading document:', error);
      res.status(500).json({ error: 'Failed to upload document', details: error });
    }
  }
);

// DELETE /:docId — remove doc from DB (s3Key noted but not deleted from S3)
router.delete('/:docId', async (req: Request, res: Response) => {
  try {
    const doc = await Doc.findByIdAndDelete(req.params.docId);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    // s3Key is available at doc.s3Key if needed for future S3 deletion
    res.json({ message: 'Document deleted', s3Key: doc.s3Key });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// GET /:docId/url — get presigned URL for a single doc
router.get('/:docId/url', async (req: Request, res: Response) => {
  try {
    const doc = await Doc.findById(req.params.docId).lean();
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!doc.s3Key) {
      res.status(400).json({ error: 'Document has no S3 key' });
      return;
    }
    const presignedUrl = await getPresignedUrl(doc.s3Key);
    res.json({ presignedUrl });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate presigned URL' });
  }
});

export default router;
