import { Router, Request, Response } from 'express';
import { PageIndexTree } from '../models/PageIndexTree';
import { Doc } from '../models/Document';
import { Inquiry } from '../models/Inquiry';
import { SearchChat } from '../models/SearchChat';
import { answerAcrossCorpus, type CorpusDoc } from '../services/contextualSearch';
import type { ChatTurn, LlmProvider } from '../services/pageIndex';

const router = Router();

function parseProvider(value: unknown): LlmProvider {
  return value === 'openai' ? 'openai' : 'gemini';
}

// ponytail: loads every done tree's pageTexts into memory per request — fine at
// current corpus size (tens of docs). Page down / cache when it isn't.
async function loadCorpus(docId?: string): Promise<CorpusDoc[]> {
  const filter = docId ? { status: 'done', documentId: docId } : { status: 'done' };
  const trees = await PageIndexTree.find(filter).lean();
  if (trees.length === 0) return [];

  const docIds = trees.map(t => t.documentId);
  const docs = await Doc.find({ _id: { $in: docIds } }).select('title inquiryId').lean();
  const docById = new Map(docs.map(d => [String(d._id), d]));

  const inquiries = await Inquiry.find({ inquiryId: { $in: [...new Set(trees.map(t => t.inquiryId))] } })
    .select('inquiryId client').lean();
  const clientByInquiry = new Map(inquiries.map(i => [i.inquiryId, i.client]));

  return trees.map(t => {
    const doc = docById.get(String(t.documentId));
    return {
      docId:      String(t.documentId),
      title:      doc?.title ?? 'Untitled document',
      inquiryId:  t.inquiryId,
      client:     clientByInquiry.get(t.inquiryId) ?? '',
      docSummary: t.docSummary,
      tree:       t.tree,
      pageTexts:  t.pageTexts,
    };
  });
}

// ─── GET /api/search/corpus ────────────────────────────────────────────────────

router.get('/corpus', async (_req: Request, res: Response) => {
  try {
    const trees = await PageIndexTree.find({ status: 'done' })
      .select('documentId inquiryId pageCount builtAt').lean();
    const docs = await Doc.find({ _id: { $in: trees.map(t => t.documentId) } })
      .select('title inquiryId').lean();
    const docById = new Map(docs.map(d => [String(d._id), d]));
    res.json(trees.map(t => ({
      docId:     String(t.documentId),
      title:     docById.get(String(t.documentId))?.title ?? 'Untitled document',
      inquiryId: t.inquiryId,
      pageCount: t.pageCount,
      builtAt:   t.builtAt,
    })));
  } catch (err) {
    console.error('[search] corpus error:', err);
    res.status(500).json({ error: 'Failed to fetch corpus.' });
  }
});

// ─── GET /api/search/chats ─────────────────────────────────────────────────────

router.get('/chats', async (_req: Request, res: Response) => {
  try {
    const chats = await SearchChat.find().sort({ updatedAt: -1 }).select('title updatedAt').lean();
    res.json(chats.map(c => ({ chatId: String(c._id), title: c.title, updatedAt: c.updatedAt })));
  } catch (err) {
    console.error('[search] chats list error:', err);
    res.status(500).json({ error: 'Failed to fetch chats.' });
  }
});

// ─── GET /api/search/chats/:chatId ─────────────────────────────────────────────

router.get('/chats/:chatId', async (req: Request, res: Response) => {
  try {
    const chat = await SearchChat.findById(req.params.chatId).lean();
    if (!chat) { res.status(404).json({ error: 'Chat not found.' }); return; }
    res.json({ chatId: String(chat._id), title: chat.title, messages: chat.messages, updatedAt: chat.updatedAt });
  } catch (err) {
    console.error('[search] chat get error:', err);
    res.status(500).json({ error: 'Failed to fetch chat.' });
  }
});

// ─── DELETE /api/search/chats/:chatId ──────────────────────────────────────────

router.delete('/chats/:chatId', async (req: Request, res: Response) => {
  try {
    await SearchChat.findByIdAndDelete(req.params.chatId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[search] chat delete error:', err);
    res.status(500).json({ error: 'Failed to delete chat.' });
  }
});

// ─── POST /api/search/ask ──────────────────────────────────────────────────────

router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { question, history, provider, docId, chatId } = req.body as { question?: string; history?: ChatTurn[]; provider?: unknown; docId?: string; chatId?: string };
    if (!question || !question.trim()) { res.status(400).json({ error: 'question is required.' }); return; }

    const corpus = await loadCorpus(docId);
    if (docId && corpus.length === 0) {
      res.status(404).json({ error: 'No indexed document with that docId.' });
      return;
    }
    if (corpus.length === 0) {
      res.status(422).json({ error: 'No indexed documents yet. Build a page index on at least one document first.' });
      return;
    }

    const result = await answerAcrossCorpus(
      corpus,
      question.trim(),
      Array.isArray(history) ? history : [],
      parseProvider(provider),
    );

    const byId = new Map(corpus.map(d => [d.docId, d]));
    const sources = result.sources.map(s => ({
      ...s,
      title:     byId.get(s.docId)?.title ?? '',
      inquiryId: byId.get(s.docId)?.inquiryId ?? '',
    }));

    let chat = chatId ? await SearchChat.findById(chatId) : null;
    if (!chat) chat = new SearchChat({ title: question.trim().slice(0, 80) });
    chat.messages.push(
      { role: 'user', text: question.trim(), sources: [] },
      { role: 'model', text: result.answer, sources },
    );
    await chat.save();

    res.json({ answer: result.answer, sources, chatId: String(chat._id) });
  } catch (err) {
    console.error('[search] ask error:', err);
    res.status(500).json({ error: 'Search failed.', details: String(err) });
  }
});

export default router;
