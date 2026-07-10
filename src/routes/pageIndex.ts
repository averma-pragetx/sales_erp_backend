import { Router, Request, Response } from 'express';
import { PageIndexTree } from '../models/PageIndexTree';
import { Doc } from '../models/Document';
import { downloadFromS3 } from '../s3';
import { extractPageTexts, buildPageIndexTree, answerFromPageIndex, type ChatTurn, type LlmProvider } from '../services/pageIndex';

const router = Router();

function parseProvider(value: unknown): LlmProvider {
  return value === 'openai' ? 'openai' : 'gemini';
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
    builtAt:    work.builtAt,
  };
}

// ─── GET /api/pageindex/:docId ─────────────────────────────────────────────────

router.get('/:docId', async (req: Request, res: Response) => {
  try {
    const work = await PageIndexTree.findOne({ documentId: req.params.docId });
    if (!work) {
      res.json({ documentId: req.params.docId, status: 'pending', error: '', provider: 'gemini', pageCount: 0, docSummary: '', tree: [], builtAt: null });
      return;
    }
    res.json(formatTree(work));
  } catch (err) {
    console.error('[pageindex] get error:', err);
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

    const { docSummary, tree } = await buildPageIndexTree(pageTexts, doc.title, provider);

    work.pageCount  = pageTexts.length;
    work.pageTexts  = pageTexts;
    work.docSummary = docSummary;
    work.tree       = tree;
    work.status     = 'done';
    work.builtAt    = new Date();
    await work.save();

    res.json(formatTree(work));
  } catch (err) {
    console.error('[pageindex] build error:', err);
    try {
      const work = await PageIndexTree.findOne({ documentId: req.params.docId });
      if (work) { work.status = 'failed'; work.error = String(err); await work.save(); }
    } catch { /* ignore */ }
    res.status(500).json({ error: 'Index build failed.', details: String(err) });
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
    console.error('[pageindex] chat error:', err);
    res.status(500).json({ error: 'Chat failed.', details: String(err) });
  }
});

export default router;
