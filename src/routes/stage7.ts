import { Router, Request, Response } from 'express';
import { Stage7Work }  from '../models/Stage7Work';
import { Stage4Work }  from '../models/Stage4Work';
import { Inquiry }     from '../models/Inquiry';
import { Doc }         from '../models/Document';
import { downloadFromS3 } from '../s3';
import { extractBom }  from '../services/stage7';

const router = Router();

function formatWork(work: InstanceType<typeof Stage7Work>) {
  return {
    inquiryId:   work.inquiryId,
    status:      work.status,
    error:       work.error,
    projectInfo: work.projectInfo,
    equipment:   work.equipment,
    extractedAt: work.extractedAt,
  };
}

function buildStage4Context(tags: { tagNumber?: string; service?: string; temaType?: string; shellOdMm?: number; tubeLengthMm?: number; nos?: number; shellSide?: { fluid?: string }; tubeSide?: { fluid?: string }; weightPerUnitT?: number }[]): string {
  if (!tags.length) return '(No Stage 4 tags extracted yet)';
  return tags.map(t => {
    const dim = [t.shellOdMm ? `⌀${t.shellOdMm}` : '', t.tubeLengthMm ? `${t.tubeLengthMm}` : ''].filter(Boolean).join('×') || '—';
    return `${t.tagNumber ?? '—'} | ${t.service ?? ''} | ${t.temaType ?? ''} | ${dim} | Shell: ${t.shellSide?.fluid ?? ''} | Tube: ${t.tubeSide?.fluid ?? ''} | ${t.weightPerUnitT ? t.weightPerUnitT + 't' : '—'}`;
  }).join('\n');
}

// ─── GET /api/stage7/:inquiryId ───────────────────────────────────────────────

router.get('/:inquiryId', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);
    const work = await Stage7Work.findOne({ inquiryId });
    if (!work) {
      res.json({ inquiryId, status: 'pending', projectInfo: {}, equipment: [], extractedAt: null });
      return;
    }
    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage7] get error:', err);
    res.status(500).json({ error: 'Failed to fetch BOM.' });
  }
});

// ─── POST /api/stage7/:inquiryId/extract ─────────────────────────────────────

router.post('/:inquiryId/extract', async (req: Request, res: Response) => {
  try {
    const inquiryId = decodeURIComponent(req.params.inquiryId);

    const inquiry = await Inquiry.findOne({ inquiryId }).lean();
    if (!inquiry) { res.status(404).json({ error: `Inquiry ${inquiryId} not found.` }); return; }

    const stage4 = await Stage4Work.findOne({ inquiryId }).lean();
    if (!stage4 || stage4.status !== 'done') {
      res.status(422).json({ error: 'Run Stage 4 extraction first — Stage 7 uses the same document.' });
      return;
    }
    if (!stage4.sourceDocumentId) {
      res.status(422).json({ error: 'Stage 4 has no source document recorded.' });
      return;
    }

    const doc = await Doc.findById(stage4.sourceDocumentId).lean();
    if (!doc) { res.status(404).json({ error: `Source document not found.` }); return; }

    let work = await Stage7Work.findOne({ inquiryId });
    if (work?.status === 'processing') {
      const age = Date.now() - new Date(work.updatedAt).getTime();
      if (age < 5 * 60 * 1000) { res.status(409).json({ error: 'BOM extraction already in progress.' }); return; }
      work.status = 'failed'; work.error = 'Previous run timed out.'; await work.save();
    }

    if (!work) work = new Stage7Work({ inquiryId });
    work.status = 'processing'; work.error = ''; await work.save();

    const buffer       = await downloadFromS3(doc.s3Key);
    const scope        = `${inquiry.client} · ${inquiry.project} — ${inquiry.scope}`;
    const stage4Context = buildStage4Context(stage4.tags ?? []);

    const result = await extractBom(buffer, doc.mimeType || 'application/pdf', inquiryId, scope, stage4Context);

    work.projectInfo = result.projectInfo;
    work.equipment   = result.equipment;
    work.status      = 'done';
    work.extractedAt = new Date();
    work.error       = '';
    await work.save();

    res.json(formatWork(work));
  } catch (err) {
    console.error('[stage7] extract error:', err);
    try {
      const inquiryId = decodeURIComponent(req.params.inquiryId);
      const work = await Stage7Work.findOne({ inquiryId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }
    res.status(500).json({ error: 'BOM extraction failed.', details: String(err) });
  }
});

export default router;
