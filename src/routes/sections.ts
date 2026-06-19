import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Section } from '../models/Section';

const router = Router();

// ─── GET /api/sections/inquiry/:inquiryId ─────────────────────────────────────
// All sections across every document for an inquiry.
// Grouped by document for easy rendering.
router.get('/inquiry/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const sections = await Section.find({ inquiryId })
      .sort({ documentId: 1, sectionIndex: 1 })
      .lean();

    // Group by document
    const byDocument: Record<string, {
      documentId: string;
      docType: string;
      documentTitle: string;
      sections: typeof sections;
    }> = {};

    for (const s of sections) {
      const key = String(s.documentId);
      if (!byDocument[key]) {
        byDocument[key] = {
          documentId:    key,
          docType:       s.docType,
          documentTitle: s.documentTitle,
          sections:      [],
        };
      }
      byDocument[key].sections.push(s);
    }

    res.json({
      inquiryId,
      totalSections: sections.length,
      documents: Object.values(byDocument),
    });
  } catch (err) {
    console.error('[sections] inquiry list error:', err);
    res.status(500).json({ error: 'Failed to fetch sections.' });
  }
});

// ─── GET /api/sections/document/:docId ────────────────────────────────────────
// All sections for a single document, in order.
router.get('/document/:docId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.docId)) {
      res.status(400).json({ error: 'Invalid document ID.' });
      return;
    }

    const sections = await Section.find({ documentId: req.params.docId })
      .sort({ sectionIndex: 1 })
      .lean();

    res.json(sections);
  } catch (err) {
    console.error('[sections] document list error:', err);
    res.status(500).json({ error: 'Failed to fetch sections.' });
  }
});

// ─── GET /api/sections/:sectionId ─────────────────────────────────────────────
// Single section by its own ID.
router.get('/:sectionId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sectionId)) {
      res.status(400).json({ error: 'Invalid section ID.' });
      return;
    }

    const section = await Section.findById(req.params.sectionId).lean();
    if (!section) {
      res.status(404).json({ error: 'Section not found.' });
      return;
    }

    res.json(section);
  } catch (err) {
    console.error('[sections] get error:', err);
    res.status(500).json({ error: 'Failed to fetch section.' });
  }
});

// ─── DELETE /api/sections/:sectionId ──────────────────────────────────────────
// Remove a single section (e.g. if it was incorrectly extracted).
router.delete('/:sectionId', async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.sectionId)) {
      res.status(400).json({ error: 'Invalid section ID.' });
      return;
    }

    const section = await Section.findByIdAndDelete(req.params.sectionId);
    if (!section) {
      res.status(404).json({ error: 'Section not found.' });
      return;
    }

    res.json({ message: 'Section deleted.', sectionId: req.params.sectionId });
  } catch (err) {
    console.error('[sections] delete error:', err);
    res.status(500).json({ error: 'Failed to delete section.' });
  }
});

export default router;
