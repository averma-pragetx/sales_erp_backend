import { Router, Request, Response } from 'express';
import { Stage5Work } from '../models/Stage5Work';

const router = Router();

async function getOrCreate(inquiryId: string) {
  return Stage5Work.findOneAndUpdate(
    { inquiryId },
    { $setOnInsert: { inquiryId } },
    { upsert: true, new: true, lean: true },
  );
}

// ─── GET /api/stage5/:inquiryId ───────────────────────────────────────────────
router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await getOrCreate(inquiryId);
    res.json({ inquiryId, checkedItems: work?.checkedItems ?? [] });
  } catch (err) {
    console.error('[stage5] get error:', err);
    res.status(500).json({ error: 'Failed to fetch stage 5 data.' });
  }
});

// ─── PATCH /api/stage5/:inquiryId ─────────────────────────────────────────────
router.patch('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const { checkedItems } = req.body as { checkedItems?: boolean[] };

    if (!Array.isArray(checkedItems)) {
      res.status(400).json({ error: 'checkedItems must be a boolean array.' });
      return;
    }

    const work = await Stage5Work.findOneAndUpdate(
      { inquiryId },
      { $set: { checkedItems } },
      { upsert: true, new: true, lean: true },
    );
    res.json({ inquiryId, checkedItems: work?.checkedItems ?? [] });
  } catch (err) {
    console.error('[stage5] patch error:', err);
    res.status(500).json({ error: 'Failed to update stage 5 data.' });
  }
});

export default router;
