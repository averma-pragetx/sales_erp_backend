import { Router, Request, Response } from 'express';
import { Inquiry } from '../models/Inquiry';

const router = Router();

// GET / — list all inquiries sorted by createdAt desc
router.get('/', async (_req: Request, res: Response) => {
  try {
    const inquiries = await Inquiry.find().lean().sort({ createdAt: -1 });
    res.json(inquiries);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    res.status(500).json({ error: 'Failed to fetch inquiries' });
  }
});

// GET /:id — get one inquiry by inquiryId
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.id);
    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) {
      res.status(404).json({ error: 'Inquiry not found' });
      return;
    }
    res.json(inquiry);
  } catch (error) {
    console.error('Error fetching inquiry:', error);
    res.status(500).json({ error: 'Failed to fetch inquiry' });
  }
});

// POST / — create a new inquiry
router.post('/', async (req: Request, res: Response) => {
  try {
    const inquiry = new Inquiry(req.body);
    const saved = await inquiry.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('Error creating inquiry:', error);
    res.status(400).json({ error: 'Failed to create inquiry', details: error });
  }
});

export default router;
