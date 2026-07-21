import { Router, Request, Response } from 'express';
import { PageIndexTree } from '../models/PageIndexTree';
import { Doc } from '../models/Document';
import { Inquiry } from '../models/Inquiry';
import { SearchChat } from '../models/SearchChat';
import { answerAcrossCorpus, type CorpusDoc } from '../services/contextualSearch';
import type { ChatTurn, LlmProvider } from '../services/pageIndex';
import { logger } from '../logger';

const router = Router();

function parseProvider(value: unknown): LlmProvider {
  return value === 'openai' || value === 'claude' ? value : 'gemini';
}

// ponytail: loads every done tree's pageTexts into memory per request — fine at
// current corpus size (tens of docs). Page down / cache when it isn't.
async function loadCorpus(docIds?: string[]): Promise<CorpusDoc[]> {
  const filter = docIds?.length ? { status: 'done', documentId: { $in: docIds } } : { status: 'done' };
  const trees = await PageIndexTree.find(filter).lean();
  if (trees.length === 0) return [];

  const treeDocIds = trees.map(t => t.documentId);
  const docs = await Doc.find({ _id: { $in: treeDocIds } }).select('title inquiryId').lean();
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
    logger.error('[search] corpus error:', err);
    res.status(500).json({ error: 'Failed to fetch corpus.' });
  }
});

// ─── GET /api/search/chats ─────────────────────────────────────────────────────

router.get('/chats', async (_req: Request, res: Response) => {
  try {
    const chats = await SearchChat.find().sort({ updatedAt: -1 }).select('title updatedAt').lean();
    res.json(chats.map(c => ({ chatId: String(c._id), title: c.title, updatedAt: c.updatedAt })));
  } catch (err) {
    logger.error('[search] chats list error:', err);
    res.status(500).json({ error: 'Failed to fetch chats.' });
  }
});

// ─── GET /api/search/chats/:chatId ─────────────────────────────────────────────

router.get('/chats/:chatId', async (req: Request, res: Response) => {
  try {
    const chat = await SearchChat.findById(req.params.chatId).lean();
    if (!chat) { res.status(404).json({ error: 'Chat not found.' }); return; }
    res.json({
      chatId: String(chat._id),
      title: chat.title,
      scopeTenderNames: chat.scopeTenderNames ?? [],
      messages: chat.messages,
      updatedAt: chat.updatedAt,
    });
  } catch (err) {
    logger.error('[search] chat get error:', err);
    res.status(500).json({ error: 'Failed to fetch chat.' });
  }
});

// ─── PATCH /api/search/chats/:chatId ───────────────────────────────────────────

router.patch('/chats/:chatId', async (req: Request, res: Response) => {
  try {
    const { title } = req.body as { title?: string };
    if (!title || !title.trim()) { res.status(400).json({ error: 'title is required.' }); return; }
    const chat = await SearchChat.findByIdAndUpdate(
      req.params.chatId,
      { title: title.trim().slice(0, 80) },
      { new: true },
    ).lean();
    if (!chat) { res.status(404).json({ error: 'Chat not found.' }); return; }
    res.json({ chatId: String(chat._id), title: chat.title, updatedAt: chat.updatedAt });
  } catch (err) {
    logger.error('[search] chat rename error:', err);
    res.status(500).json({ error: 'Failed to rename chat.' });
  }
});

// ─── DELETE /api/search/chats/:chatId ──────────────────────────────────────────

router.delete('/chats/:chatId', async (req: Request, res: Response) => {
  try {
    await SearchChat.findByIdAndDelete(req.params.chatId);
    res.json({ ok: true });
  } catch (err) {
    logger.error('[search] chat delete error:', err);
    res.status(500).json({ error: 'Failed to delete chat.' });
  }
});

// ─── POST /api/search/ask ──────────────────────────────────────────────────────

router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { question, history, provider, docIds, chatId, scopeTenderNames } = req.body as {
      question?: string; history?: ChatTurn[]; provider?: unknown; docIds?: string[]; chatId?: string; scopeTenderNames?: string[];
    };
    if (!question || !question.trim()) { res.status(400).json({ error: 'question is required.' }); return; }

    const scope = Array.isArray(docIds) ? docIds.filter(id => typeof id === 'string' && id.trim()) : [];
    logger.debug(`[search] ask "${question.trim().slice(0, 80)}" provider=${parseProvider(provider)} scope=${scope.length || 'all'} chatId=${chatId || 'new'}`);
    const corpus = await loadCorpus(scope);
    if (scope.length > 0 && corpus.length === 0) {
      res.status(404).json({ error: 'None of the selected documents have a built page index.' });
      return;
    }
    if (corpus.length === 0) {
      res.status(422).json({ error: 'No indexed documents yet. Build a page index on at least one document first.' });
      return;
    }

    // Past-chat context is server-authoritative: when continuing a chat, history
    // comes from the stored messages, not the client. Last 12 messages keeps
    // long chats inside the model's context without losing recent thread.
    let chat = chatId ? await SearchChat.findById(chatId) : null;
    const chatHistory: ChatTurn[] = chat
      ? chat.messages.slice(-12).map(m => ({ role: m.role, text: m.text }))
      : Array.isArray(history) ? history : [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (data: Record<string, unknown>) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const result = await answerAcrossCorpus(
      corpus,
      question.trim(),
      chatHistory,
      parseProvider(provider),
      token => send({ token }),
    );

    const byId = new Map(corpus.map(d => [d.docId, d]));
    const sources = result.sources.map(s => ({
      ...s,
      title:     byId.get(s.docId)?.title ?? '',
      inquiryId: byId.get(s.docId)?.inquiryId ?? '',
    }));

    if (!chat) chat = new SearchChat({ title: question.trim().slice(0, 80) });
    if (Array.isArray(scopeTenderNames)) chat.scopeTenderNames = scopeTenderNames.filter(t => typeof t === 'string' && t.trim());
    chat.messages.push(
      { role: 'user', text: question.trim(), sources: [] },
      { role: 'model', text: result.answer, sources },
    );
    await chat.save();

    logger.info(`[search] ask answered chatId=${chat._id} sources=${sources.length}`);
    send({ done: true, sources, chatId: String(chat._id) });
    res.end();
  } catch (err) {
    logger.error('[search] ask error:', err);
    if (!res.headersSent) { res.status(500).json({ error: 'Search failed.', details: String(err) }); return; }
    res.write(`data: ${JSON.stringify({ error: 'Search failed.' })}\n\n`);
    res.end();
  }
});

export default router;
