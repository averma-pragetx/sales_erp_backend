import { Type, FunctionCallingConfigMode } from '@google/genai';
import OpenAI from 'openai';
import type { IPageIndexNode } from '../models/PageIndexTree';
import { searchDocument, type ChatTurn } from './pageIndex';
import { getGemini, getOpenAI, GEMINI_MODEL, OPENAI_MODEL, type LlmProvider } from '../ai/clients';

export interface CorpusDoc {
  docId: string;
  title: string;
  inquiryId: string;
  client: string;
  docSummary: string;
  tree: IPageIndexNode[];
  pageTexts: string[];
}

const MAX_TOOL_TURNS = 8;
const MAX_PAGE_CHARS_PER_CALL = 60_000;
const MAX_CORPUS_SEARCH_HITS = 20;

function buildSystemInstruction(docs: CorpusDoc[]): string {
  const catalog = docs.map(d => ({
    docId: d.docId,
    title: d.title,
    inquiry: d.inquiryId,
    client: d.client,
    summary: d.docSummary,
    sections: d.tree.map(n => ({ title: n.title, pages: `${n.startPage}-${n.endPage}` })),
  }));
  return (
    `You are answering questions across a corpus of ${docs.length} indexed sales/tender documents. ` +
    `Each document belongs to an inquiry. Use the catalog below to decide where to look, then fetch real ` +
    `text before answering — never answer from catalog summaries alone.\n\n` +
    `Catalog (docId, title, inquiry, client, summary, top-level sections), JSON:\n${JSON.stringify(catalog)}\n\n` +
    `Tools:\n` +
    `- search_corpus(query): case-insensitive keyword search across every page of every document. Use it to ` +
    `locate a term, tag number, clause, or value, or to find which documents mention something. If no matches, ` +
    `try 2-3 alternative phrasings before concluding the term is absent.\n` +
    `- get_page_content(docId, startPage, endPage): fetch raw text of a tight page range from one document. ` +
    `If a result ends with [TRUNCATED], re-fetch a narrower range.\n\n` +
    `Answering:\n` +
    `- Your text reply is ALWAYS shown to the user as the final answer. Never write intentions or progress ` +
    `notes like "I will now search for..." — if you still need to look something up, call a tool instead of ` +
    `writing text.\n` +
    `- Quote exact figures, names, tags, and values verbatim from fetched text.\n` +
    `- Cite the document title and page inline for every fact, e.g. "(Tender Spec, p. 12)".\n` +
    `- When a question spans documents/inquiries, check each plausible document, not just the first hit.\n` +
    `- If the fetched content does not answer the question, say so plainly instead of guessing.\n\n` +
    `Visualization — use the right form for the data:\n` +
    `- Markdown table: structured multi-column detail (specs, tag lists, compliance items, anything with 2+ ` +
    `attributes per row). Use freely; tables render natively.\n` +
    `- Chart: comparable numbers (costs, quantities, counts, scores, dimensions across items). Emit as a fenced ` +
    `block, exactly this format:\n` +
    '```chart\n{"type":"bar","title":"Design pressure by exchanger","unit":"bar(g)","labels":["E-101","E-102"],"values":[18.5,22]}\n```\n' +
    `- Chart types: "bar" — compare labeled items; "line" — trend across ordered points (labels are the x values); ` +
    `"stat" — one headline number: {"type":"stat","title":"...","value":42.5,"unit":"₹ Cr"}.\n` +
    `- Combine forms when useful: a table for the detail plus a chart for the headline comparison.\n` +
    `- Every number in a chart or table must come verbatim from fetched text — never estimate or invent. Max 12 bars.\n` +
    `- The prose answer must stand alone without the visuals; they supplement it. ` +
    `Skip charts for single facts (unless a "stat" fits) or non-numeric answers.`
  );
}

function clampPage(n: unknown, pageCount: number, fallback: number): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.round(num), 1), Math.max(pageCount, 1));
}

function searchCorpus(docs: CorpusDoc[], queryArg: unknown): string {
  const query = String(queryArg ?? '').trim();
  if (!query) return 'No search query provided.';
  const out: string[] = [];
  for (const d of docs) {
    if (out.length >= MAX_CORPUS_SEARCH_HITS) break;
    const result = searchDocument(d.pageTexts, query);
    if (result.startsWith('No matches')) continue;
    out.push(`### ${d.title} (docId: ${d.docId}, inquiry: ${d.inquiryId})\n${result}`);
  }
  return out.length > 0
    ? out.join('\n\n')
    : `No matches found for "${query}" in any document. Try a shorter or differently worded term.`;
}

function fetchPages(
  docs: CorpusDoc[],
  docIdArg: unknown,
  startArg: unknown,
  endArg: unknown,
  pagesUsed: Map<string, Set<number>>,
): string {
  const doc = docs.find(d => d.docId === String(docIdArg ?? ''));
  if (!doc) return `Unknown docId "${String(docIdArg)}". Use a docId from the catalog.`;

  const start = clampPage(startArg, doc.pageTexts.length, 1);
  const end   = Math.max(clampPage(endArg, doc.pageTexts.length, start), start);
  let used = pagesUsed.get(doc.docId);
  if (!used) { used = new Set(); pagesUsed.set(doc.docId, used); }
  for (let p = start; p <= end; p++) used.add(p);

  const joined = doc.pageTexts.slice(start - 1, end).join('\n\n');
  if (joined.length <= MAX_PAGE_CHARS_PER_CALL) return joined;
  return joined.slice(0, MAX_PAGE_CHARS_PER_CALL) +
    '\n\n[TRUNCATED — this range is too large to return in full. Call get_page_content again with a narrower range to see the rest.]';
}

export interface SearchSource { docId: string; pages: number[] }
export interface SearchResult { answer: string; sources: SearchSource[] }

function collectSources(pagesUsed: Map<string, Set<number>>): SearchSource[] {
  return [...pagesUsed.entries()].map(([docId, pages]) => ({
    docId,
    pages: [...pages].sort((a, b) => a - b),
  }));
}

const NO_ANSWER = 'I was unable to find enough information in the indexed documents to answer confidently.';

const SEARCH_DECL_GEMINI = {
  name: 'search_corpus',
  description: 'Case-insensitive keyword/phrase search across every page of every indexed document. Returns matching documents, page numbers, and surrounding snippets.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'A specific word or short phrase, e.g. a tag number, material grade, or clause reference.' },
    },
    required: ['query'],
  },
};

const GET_PAGES_DECL_GEMINI = {
  name: 'get_page_content',
  description: 'Fetch the raw text of a page range from one document in the corpus. Keep the range tight.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      docId:     { type: Type.STRING,  description: 'docId from the catalog or a search_corpus result.' },
      startPage: { type: Type.INTEGER, description: '1-based inclusive start page.' },
      endPage:   { type: Type.INTEGER, description: '1-based inclusive end page.' },
    },
    required: ['docId', 'startPage', 'endPage'],
  },
};

const TOOLS_GEMINI = { functionDeclarations: [SEARCH_DECL_GEMINI, GET_PAGES_DECL_GEMINI] };

function runTool(
  name: string | undefined,
  args: Record<string, unknown> | undefined,
  docs: CorpusDoc[],
  pagesUsed: Map<string, Set<number>>,
): string {
  if (name === 'search_corpus') return searchCorpus(docs, args?.query);
  return fetchPages(docs, args?.docId, args?.startPage, args?.endPage, pagesUsed);
}

async function askGemini(docs: CorpusDoc[], question: string, history: ChatTurn[]): Promise<SearchResult> {
  const ai = getGemini();
  const pagesUsed = new Map<string, Set<number>>();
  const systemInstruction = buildSystemInstruction(docs);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: isLastTurn
        ? { systemInstruction }
        : {
            systemInstruction,
            tools: [TOOLS_GEMINI],
            toolConfig: turn === 0
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
              : undefined,
          },
    });

    const calls = res.functionCalls ?? [];
    if (calls.length === 0) {
      return { answer: res.text?.trim() || NO_ANSWER, sources: collectSources(pagesUsed) };
    }

    contents.push({ role: 'model', parts: calls.map(c => ({ functionCall: c })) });
    contents.push({
      role: 'user',
      parts: calls.map(c => ({
        functionResponse: { name: c.name, response: { output: runTool(c.name, c.args, docs, pagesUsed) } },
      })),
    });
  }

  return { answer: NO_ANSWER, sources: collectSources(pagesUsed) };
}

const TOOLS_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_corpus',
      description: 'Case-insensitive keyword/phrase search across every page of every indexed document. Returns matching documents, page numbers, and surrounding snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A specific word or short phrase, e.g. a tag number, material grade, or clause reference.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_content',
      description: 'Fetch the raw text of a page range from one document in the corpus. Keep the range tight.',
      parameters: {
        type: 'object',
        properties: {
          docId:     { type: 'string',  description: 'docId from the catalog or a search_corpus result.' },
          startPage: { type: 'integer', description: '1-based inclusive start page.' },
          endPage:   { type: 'integer', description: '1-based inclusive end page.' },
        },
        required: ['docId', 'startPage', 'endPage'],
      },
    },
  },
];

async function askOpenAI(docs: CorpusDoc[], question: string, history: ChatTurn[]): Promise<SearchResult> {
  const ai = getOpenAI();
  const pagesUsed = new Map<string, Set<number>>();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemInstruction(docs) },
    ...history.map(h => ({ role: h.role === 'model' ? 'assistant' as const : 'user' as const, content: h.text })),
    { role: 'user', content: question },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    const res = await ai.chat.completions.create(
      isLastTurn
        ? { model: OPENAI_MODEL, messages }
        : { model: OPENAI_MODEL, messages, tools: TOOLS_OPENAI, tool_choice: turn === 0 ? 'required' : 'auto' },
    );

    const msg = res.choices[0].message;
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { answer: msg.content?.trim() || NO_ANSWER, sources: collectSources(pagesUsed) };
    }

    messages.push({ role: 'assistant', content: msg.content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      messages.push({ role: 'tool', tool_call_id: call.id, content: runTool(call.function.name, args, docs, pagesUsed) });
    }
  }

  return { answer: NO_ANSWER, sources: collectSources(pagesUsed) };
}

export async function answerAcrossCorpus(
  docs: CorpusDoc[],
  question: string,
  history: ChatTurn[],
  provider: LlmProvider,
): Promise<SearchResult> {
  return provider === 'openai'
    ? askOpenAI(docs, question, history)
    : askGemini(docs, question, history);
}
