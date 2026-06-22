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

// PATCH /:id — update completedUpTo, currentStage, currentStageName
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.id);
    const { completedUpTo, currentStage, currentStageName } = req.body;

    const fields: Record<string, unknown> = {};
    if (completedUpTo !== undefined) fields.completedUpTo = completedUpTo;
    if (currentStage !== undefined) fields.currentStage = currentStage;
    if (currentStageName !== undefined) fields.currentStageName = currentStageName;

    const updated = await Inquiry.findOneAndUpdate(
      { inquiryId },
      { $set: fields },
      { new: true, lean: true },
    );

    if (!updated) {
      res.status(404).json({ error: 'Inquiry not found' });
      return;
    }
    res.json(updated);
  } catch (error) {
    console.error('Error updating inquiry:', error);
    res.status(500).json({ error: 'Failed to update inquiry' });
  }
});

// PATCH /:id/kanban — update cluster (and reset stage) on drag-and-drop
router.patch('/:id/kanban', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.id);
    const { cluster } = req.body;

    if (!cluster) {
      res.status(400).json({ error: 'cluster is required' });
      return;
    }

    // Maps each cluster to the first stage number and its display name
    const clusterDefaults: Record<string, { stage: number; stageName: string }> = {
      intake:     { stage: 1,  stageName: 'Intake' },
      estimation: { stage: 3,  stageName: 'Estimation' },
      proposal:   { stage: 8,  stageName: 'Proposal' },
      bid_active: { stage: 10, stageName: 'Bid Active' },
      outcome:    { stage: 12, stageName: 'Outcome' },
    };

    if (!clusterDefaults[cluster]) {
      res.status(400).json({
        error: `Invalid cluster. Must be one of: ${Object.keys(clusterDefaults).join(', ')}`,
      });
      return;
    }

    const { stage, stageName } = clusterDefaults[cluster];

    const updated = await Inquiry.findOneAndUpdate(
      { inquiryId },
      { $set: { cluster, currentStage: stage, currentStageName: stageName } },
      { new: true, lean: true },
    );

    if (!updated) {
      res.status(404).json({ error: 'Inquiry not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating inquiry cluster:', error);
    res.status(500).json({ error: 'Failed to update inquiry cluster' });
  }
});

export default router;
