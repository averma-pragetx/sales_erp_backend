import { Router, Request, Response } from 'express';
import { PageIndexTree } from '../models/PageIndexTree';
import { PageIndexTreeVersion } from '../models/PageIndexTreeVersion';
import { Doc } from '../models/Document';
import { downloadFromS3 } from '../s3';
import { extractPageTexts, buildPageIndexTree, repairPageIndexTree, isFixableFlag, answerFromPageIndex, type ChatTurn, type LlmProvider } from '../services/pageIndex';
import { logger } from '../logger';

const router = Router();

function parseProvider(value: unknown): LlmProvider {
  return value === 'openai' || value === 'claude' ? value : 'gemini';
}

function formatTree(work: InstanceType<typeof PageIndexTree>) {
  return {
    documentId: work.documentId,
    status:     work.status,
    error:      work.error,
    provider:   work.provider,
    pageCount:  work.pageCount,
    docSummary: work.docSummary,
    tree:       work.tree,
    qualityFlags:   work.qualityFlags,
    currentVersion: work.currentVersion,
    builtAt:    work.builtAt,
  };
}

// Appends an immutable version row and advances work.currentVersion. Called
// right before work.save() so the two stay in lockstep — the version log is
// the audit trail; work always mirrors its latest entry for fast reads.
async function recordVersion(
  work: InstanceType<typeof PageIndexTree>,
  action: 'build' | 'repair',
): Promise<void> {
  work.currentVersion += 1;
  await PageIndexTreeVersion.create({
    documentId:    work.documentId,
    versionNumber: work.currentVersion,
    action,
    provider:      work.provider,
    pageCount:     work.pageCount,
    docSummary:    work.docSummary,
    tree:          work.tree,
    qualityFlags:  work.qualityFlags,
  });
}

// ─── GET /api/pageindex/:docId ─────────────────────────────────────────────────

router.get('/:docId', async (req: Request, res: Response) => {
  try {
    const work = await PageIndexTree.findOne({ documentId: req.params.docId });
    if (!work) {
      res.json({ documentId: req.params.docId, status: 'pending', error: '', provider: 'gemini', pageCount: 0, docSummary: '', tree: [], qualityFlags: [], currentVersion: 0, builtAt: null });
      return;
    }
    res.json(formatTree(work));
  } catch (err) {
    logger.error('[pageindex] get error:', err);
    res.status(500).json({ error: 'Failed to fetch page index.' });
  }
});

// ─── POST /api/pageindex/:docId/build ─────────────────────────────────────────

router.post('/:docId/build', async (req: Request, res: Response) => {
  try {
    const provider = parseProvider((req.body as { provider?: unknown })?.provider);

    const doc = await Doc.findById(req.params.docId);
    if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }
    if (!doc.s3Key) { res.status(400).json({ error: 'No file uploaded for this document.' }); return; }

    let work = await PageIndexTree.findOne({ documentId: doc._id });
    if (work?.status === 'processing') {
      const age = Date.now() - new Date(work.updatedAt).getTime();
      if (age < 5 * 60 * 1000) { res.status(409).json({ error: 'Index build already in progress.' }); return; }
    }

    if (!work) work = new PageIndexTree({ documentId: doc._id, inquiryId: doc.inquiryId });
    work.status   = 'processing';
    work.error    = '';
    work.provider = provider;
    await work.save();

    const buffer    = await downloadFromS3(doc.s3Key);
    const pageTexts = await extractPageTexts(buffer);
    if (pageTexts.length === 0) {
      throw new Error('No extractable text found in this document (scanned/image PDF?).');
    }

    const { docSummary, tree, qualityFlags } = await buildPageIndexTree(pageTexts, doc.title, provider);

    work.pageCount    = pageTexts.length;
    work.pageTexts    = pageTexts;
    work.docSummary   = docSummary;
    work.tree         = tree;
    work.qualityFlags = qualityFlags;
    work.status       = 'done';
    work.builtAt      = new Date();
    await recordVersion(work, 'build');
    await work.save();

    if (qualityFlags.length) {
      console.warn(`[pageindex] build for ${doc._id} completed with ${qualityFlags.length} quality flag(s):\n  - ${qualityFlags.join('\n  - ')}`);
    }

    res.json(formatTree(work));
  } catch (err) {
    logger.error('[pageindex] build error:', err);
    try {
      const work = await PageIndexTree.findOne({ documentId: req.params.docId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }
    res.status(500).json({ error: 'Index build failed.', details: String(err) });
  }
});

// ─── POST /api/pageindex/:docId/repair ────────────────────────────────────────
// Targeted fix for validateTree's complaints (gaps, overlaps, thin summaries,
// bad ranges) — not a full rebuild. Doesn't touch flags it can't mechanically
// resolve (e.g. "document exceeded analysis limit").

router.post('/:docId/repair', async (req: Request, res: Response) => {
  try {
    const requestedProvider = (req.body as { provider?: unknown })?.provider;

    const doc = await Doc.findById(req.params.docId);
    if (!doc) { res.status(404).json({ error: 'Document not found.' }); return; }

    const work = await PageIndexTree.findOne({ documentId: doc._id });
    if (!work || work.status !== 'done') {
      res.status(422).json({ error: 'Build the page index for this document before repairing it.' });
      return;
    }

    const fixable = work.qualityFlags.filter(isFixableFlag);
    if (fixable.length === 0) {
      res.json(formatTree(work));
      return;
    }

    const provider = requestedProvider === undefined ? work.provider : parseProvider(requestedProvider);

    work.status   = 'processing';
    work.error    = '';
    work.provider = provider;
    await work.save();

    const { docSummary, tree, qualityFlags } = await repairPageIndexTree(
      work.pageTexts, doc.title, work.tree, fixable, provider,
    );

    work.docSummary   = docSummary;
    work.tree         = tree;
    work.qualityFlags = qualityFlags;
    work.status       = 'done';
    work.builtAt      = new Date();
    await recordVersion(work, 'repair');
    await work.save();

    res.json(formatTree(work));
  } catch (err) {
    logger.error('[pageindex] repair error:', err);
    try {
      const work = await PageIndexTree.findOne({ documentId: req.params.docId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }
    res.status(500).json({ error: 'Index repair failed.', details: String(err) });
  }
});

// ─── GET /api/pageindex/:docId/versions ───────────────────────────────────────
// Full audit trail, newest first — the original AI-built tree (versionNumber 1)
// and every build/repair since, each an immutable snapshot.

router.get('/:docId/versions', async (req: Request, res: Response) => {
  try {
    const versions = await PageIndexTreeVersion
      .find({ documentId: req.params.docId })
      .sort({ versionNumber: -1 })
      .select('versionNumber action provider pageCount docSummary tree qualityFlags createdAt')
      .lean();
    res.json(versions);
  } catch (err) {
    logger.error('[pageindex] versions error:', err);
    res.status(500).json({ error: 'Failed to fetch version history.' });
  }
});

// ─── POST /api/pageindex/:docId/chat ──────────────────────────────────────────

router.post('/:docId/chat', async (req: Request, res: Response) => {
  try {
    const { message, history, provider } = req.body as { message: string; history?: ChatTurn[]; provider?: unknown };
    if (!message || !message.trim()) { res.status(400).json({ error: 'message is required.' }); return; }

    const work = await PageIndexTree.findOne({ documentId: req.params.docId });
    if (!work || work.status !== 'done') {
      res.status(422).json({ error: 'Build the page index for this document before chatting.' });
      return;
    }

    const result = await answerFromPageIndex(
      work.tree,
      work.docSummary,
      work.pageTexts,
      message.trim(),
      Array.isArray(history) ? history : [],
      parseProvider(provider),
    );

    res.json(result);
  } catch (err) {
    logger.error('[pageindex] chat error:', err);
    res.status(500).json({ error: 'Chat failed.', details: String(err) });
  }
});

export default router;
