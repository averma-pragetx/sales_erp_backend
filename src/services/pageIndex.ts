import { GoogleGenAI, Type, FunctionCallingConfigMode } from '@google/genai';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import type { IPageIndexNode } from '../models/PageIndexTree';

export type LlmProvider = 'gemini' | 'openai';

// ─── Clients ───────────────────────────────────────────────────────────────────

let _gemini: GoogleGenAI | null = null;
let _openai: OpenAI | null = null;

function getGemini(): GoogleGenAI {
  if (!_gemini) {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in env.');
    _gemini = new GoogleGenAI({ apiKey });
  }
  return _gemini;
}

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

const GEMINI_MODEL = 'gemini-2.5-flash';
const OPENAI_MODEL = 'gpt-5.4';

// ─── 1. Per-page text extraction (no LLM — standard PDF text parsing) ────────

export async function extractPageTexts(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map(p => p.text);
  } finally {
    await parser.destroy();
  }
}

// ─── 2. Tree builder ───────────────────────────────────────────────────────────
// ponytail: tree nesting is capped at 2 static levels (sections/subsections) —
// neither provider's structured/JSON output is set up for recursive schemas
// here. Deepen only if a real document needs a 3rd level. Also caps input at
// ~250k chars per call, no continuation-loop for oversized docs — add if a
// real RFQ doc hits the cap.

const MAX_INPUT_CHARS = 250_000;

interface RawNode {
  title?: string;
  startPage?: number;
  endPage?: number;
  summary?: string;
  subsections?: RawNode[];
}

interface RawTree {
  docSummary?: string;
  sections?: RawNode[];
}

function clampPage(n: unknown, pageCount: number, fallback: number): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.round(num), 1), Math.max(pageCount, 1));
}

function normalizeTree(rawSections: RawNode[], pageCount: number): IPageIndexNode[] {
  return rawSections.map((s, i) => {
    const startPage = clampPage(s.startPage, pageCount, 1);
    const endPage   = Math.max(clampPage(s.endPage, pageCount, startPage), startPage);
    return {
      nodeId:    `sec-${i + 1}`,
      title:     String(s.title ?? `Section ${i + 1}`),
      startPage,
      endPage,
      summary:   String(s.summary ?? ''),
      nodes: (s.subsections ?? []).map((sub, j) => {
        const subStart = clampPage(sub.startPage, pageCount, startPage);
        const subEnd    = Math.max(clampPage(sub.endPage, pageCount, subStart), subStart);
        return {
          nodeId:    `sec-${i + 1}-${j + 1}`,
          title:     String(sub.title ?? `Subsection ${j + 1}`),
          startPage: subStart,
          endPage:   subEnd,
          summary:   String(sub.summary ?? ''),
          nodes:     [],
        };
      }),
    };
  });
}

function buildTreeInstructions(pageTexts: string[], docTitle: string): string {
  const numbered = pageTexts
    .map((t, i) => `<page_${i + 1}>\n${t}\n</page_${i + 1}>`)
    .join('\n\n')
    .slice(0, MAX_INPUT_CHARS);

  return (
    `You are analyzing "${docTitle}", a ${pageTexts.length}-page document. Build a table-of-contents-style outline of its structure — ` +
    `the same way a human would flip through it and note where each part begins and ends.\n\n` +
    `Read the page-tagged text below and identify the major sections (and subsections only where the document has ` +
    `real internal structure — do not force subsections onto a short or flat document). For each section, give an exact ` +
    `title, the inclusive start/end page numbers, and a summary precise enough that someone could judge relevance without reading the pages.\n\n` +
    `${numbered}`
  );
}

const TREE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    docSummary: {
      type: Type.STRING,
      description: 'Two to three sentences: what this document is and its overall structure.',
    },
    sections: {
      type: Type.ARRAY,
      description: 'Top-level sections of the document, in page order. Cover the whole document, no gaps.',
      items: {
        type: Type.OBJECT,
        properties: {
          title:     { type: Type.STRING, description: 'Exact or best-inferred section title.' },
          startPage: { type: Type.INTEGER, description: '1-based inclusive start page.' },
          endPage:   { type: Type.INTEGER, description: '1-based inclusive end page.' },
          summary:   {
            type: Type.STRING,
            description: 'One to two sentences describing what this section covers, specific enough to judge relevance without reading it.',
          },
          subsections: {
            type: Type.ARRAY,
            description: 'Nested subsections, only if the document has real internal structure here. Empty array if none.',
            items: {
              type: Type.OBJECT,
              properties: {
                title:     { type: Type.STRING },
                startPage: { type: Type.INTEGER },
                endPage:   { type: Type.INTEGER },
                summary:   { type: Type.STRING },
              },
              required: ['title', 'startPage', 'endPage', 'summary'],
            },
          },
        },
        required: ['title', 'startPage', 'endPage', 'summary', 'subsections'],
      },
    },
  },
  required: ['docSummary', 'sections'],
};

async function buildTreeGemini(pageTexts: string[], docTitle: string): Promise<RawTree> {
  const ai = getGemini();

  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: buildTreeInstructions(pageTexts, docTitle) }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   TREE_SCHEMA,
      maxOutputTokens:  16000,
    },
  });

  const raw = res.text?.trim();
  if (!raw) throw new Error('Gemini returned an empty tree.');
  return JSON.parse(raw) as RawTree;
}

const TREE_JSON_SHAPE =
  `Respond ONLY with valid JSON matching exactly this structure:\n` +
  `{\n` +
  `  "docSummary": "string",\n` +
  `  "sections": [\n` +
  `    {\n` +
  `      "title": "string", "startPage": 0, "endPage": 0, "summary": "string",\n` +
  `      "subsections": [ { "title": "string", "startPage": 0, "endPage": 0, "summary": "string" } ]\n` +
  `    }\n` +
  `  ]\n` +
  `}\n` +
  `"subsections" must be an empty array when the document has no real internal structure at that point.`;

async function buildTreeOpenAI(pageTexts: string[], docTitle: string): Promise<RawTree> {
  const ai = getOpenAI();

  const res = await ai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 16000,
    messages: [
      { role: 'system', content: TREE_JSON_SHAPE },
      { role: 'user', content: buildTreeInstructions(pageTexts, docTitle) },
    ],
  });

  const raw = res.choices[0].message.content;
  if (!raw) throw new Error('OpenAI returned an empty tree.');
  return JSON.parse(raw) as RawTree;
}

export async function buildPageIndexTree(
  pageTexts: string[],
  docTitle:  string,
  provider:  LlmProvider,
): Promise<{ docSummary: string; tree: IPageIndexNode[] }> {
  const raw = provider === 'openai'
    ? await buildTreeOpenAI(pageTexts, docTitle)
    : await buildTreeGemini(pageTexts, docTitle);

  return {
    docSummary: raw.docSummary ?? '',
    tree:       normalizeTree(raw.sections ?? [], pageTexts.length),
  };
}

// ─── 3. Retrieval — reasoning over the tree, targeted page fetch, keyword search ──
// ponytail: two function-calling tools (get_page_content, search_document),
// capped at 6 round trips. No get_structure/get_document tools — the tree is
// small, it's just inlined into the system instruction instead of paid for as
// a tool round trip. search_document is plain case-insensitive substring
// matching, not embeddings — stays "vectorless", just covers the case where a
// specific term/figure isn't obviously named in a section summary.

const MAX_TOOL_TURNS = 6;
const MAX_PAGE_CHARS_PER_CALL = 60_000;
const MAX_SEARCH_RESULTS = 15;
const SEARCH_SNIPPET_RADIUS = 200;

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

function buildSystemInstruction(tree: IPageIndexNode[], docSummary: string): string {
  return (
    `You are answering questions about a document using its structure map instead of reading the whole thing.\n\n` +
    `Document summary: ${docSummary}\n\n` +
    `Structure (titles, page ranges, summaries), JSON:\n${JSON.stringify(tree)}\n\n` +
    `You MUST ground every answer in text you actually fetched this turn — never answer from the structure ` +
    `summaries alone, they are only a map for deciding where to look.\n\n` +
    `Tools:\n` +
    `- get_page_content(startPage, endPage): use once you've picked a specific relevant section/subsection from ` +
    `the structure above. Keep the range TIGHT — just the pages you need. Call it again for another range.\n` +
    `- search_document(query): use when the question names a specific term, tag/clause/item number, or value ` +
    `that might not be mentioned in a section summary, or when you are not sure which section covers it. Follow ` +
    `up with get_page_content on the matching page(s) to read full context before answering.\n\n` +
    `Be precise and specific: quote exact figures, names, and values verbatim from the fetched text rather than ` +
    `paraphrasing loosely. Cite the page numbers your answer relies on. If the fetched content doesn't actually ` +
    `answer the question, say so plainly instead of guessing or padding with generic commentary.`
  );
}

function fetchPageRange(pageTexts: string[], startArg: unknown, endArg: unknown, pagesUsed: Set<number>): string {
  const start = clampPage(startArg, pageTexts.length, 1);
  const end   = Math.max(clampPage(endArg, pageTexts.length, start), start);
  for (let p = start; p <= end; p++) pagesUsed.add(p);

  const joined = pageTexts.slice(start - 1, end).join('\n\n');
  if (joined.length <= MAX_PAGE_CHARS_PER_CALL) return joined;
  return joined.slice(0, MAX_PAGE_CHARS_PER_CALL) +
    '\n\n[TRUNCATED — this range is too large to return in full. Call get_page_content again with a narrower range to see the rest.]';
}

function searchDocument(pageTexts: string[], queryArg: unknown): string {
  const query = String(queryArg ?? '').trim();
  if (!query) return 'No search query provided.';

  const needle = query.toLowerCase();
  const hits: string[] = [];
  for (let i = 0; i < pageTexts.length && hits.length < MAX_SEARCH_RESULTS; i++) {
    const text = pageTexts[i];
    const idx = text.toLowerCase().indexOf(needle);
    if (idx === -1) continue;
    const from = Math.max(0, idx - SEARCH_SNIPPET_RADIUS);
    const to   = Math.min(text.length, idx + needle.length + SEARCH_SNIPPET_RADIUS);
    const snippet = text.slice(from, to).replace(/\s+/g, ' ').trim();
    hits.push(`Page ${i + 1}: …${snippet}…`);
  }

  return hits.length > 0
    ? hits.join('\n\n')
    : `No matches found for "${query}". Try a shorter or differently worded term, or navigate via the structure map instead.`;
}

const GET_PAGES_DECL_GEMINI = {
  name: 'get_page_content',
  description:
    'Fetch the raw text of a page range from the document. Call this only after choosing a specific ' +
    'relevant range from the document structure — never fetch the whole document. Call it again if you ' +
    'need another range.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      startPage: { type: Type.INTEGER, description: '1-based inclusive start page.' },
      endPage:   { type: Type.INTEGER, description: '1-based inclusive end page.' },
    },
    required: ['startPage', 'endPage'],
  },
};

const SEARCH_DECL_GEMINI = {
  name: 'search_document',
  description:
    'Case-insensitive keyword/phrase search across every page of the document. Use this to locate a specific ' +
    'term, tag number, clause reference, or value that the structure summaries do not obviously cover. Returns ' +
    'matching page numbers with a snippet of surrounding text.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: { type: Type.STRING, description: 'A specific word or short phrase to search for, e.g. a tag number or clause reference.' },
    },
    required: ['query'],
  },
};

const RETRIEVAL_TOOLS_GEMINI = { functionDeclarations: [GET_PAGES_DECL_GEMINI, SEARCH_DECL_GEMINI] };

function runToolGemini(name: string | undefined, args: Record<string, unknown> | undefined, pageTexts: string[], pagesUsed: Set<number>): string {
  if (name === 'search_document') return searchDocument(pageTexts, args?.query);
  return fetchPageRange(pageTexts, args?.startPage, args?.endPage, pagesUsed);
}

async function answerGemini(
  tree: IPageIndexNode[],
  docSummary: string,
  pageTexts: string[],
  question: string,
  history: ChatTurn[],
): Promise<{ answer: string; pagesUsed: number[] }> {
  const ai = getGemini();
  const pagesUsed = new Set<number>();
  const systemInstruction = buildSystemInstruction(tree, docSummary);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction,
        tools: [RETRIEVAL_TOOLS_GEMINI],
        // Force at least one real lookup before the model is allowed to answer —
        // otherwise it tends to just paraphrase the structure summaries.
        toolConfig: turn === 0
          ? { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
          : undefined,
      },
    });

    const calls = res.functionCalls ?? [];
    if (calls.length === 0) {
      return { answer: res.text?.trim() ?? '', pagesUsed: [...pagesUsed].sort((a, b) => a - b) };
    }

    contents.push({ role: 'model', parts: calls.map(c => ({ functionCall: c })) });
    const responseParts = calls.map(c => ({
      functionResponse: {
        name: c.name,
        response: { output: runToolGemini(c.name, c.args, pageTexts, pagesUsed) },
      },
    }));
    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    answer:    'I could not narrow this down within the allowed number of lookups — try asking a more specific question.',
    pagesUsed: [...pagesUsed].sort((a, b) => a - b),
  };
}

const GET_PAGES_TOOL_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'get_page_content',
    description:
      'Fetch the raw text of a page range from the document. Call this only after choosing a specific ' +
      'relevant range from the document structure — never fetch the whole document. Call it again if you ' +
      'need another range.',
    parameters: {
      type: 'object',
      properties: {
        startPage: { type: 'integer', description: '1-based inclusive start page.' },
        endPage:   { type: 'integer', description: '1-based inclusive end page.' },
      },
      required: ['startPage', 'endPage'],
    },
  },
};

const SEARCH_TOOL_OPENAI: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_document',
    description:
      'Case-insensitive keyword/phrase search across every page of the document. Use this to locate a specific ' +
      'term, tag number, clause reference, or value that the structure summaries do not obviously cover. Returns ' +
      'matching page numbers with a snippet of surrounding text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A specific word or short phrase to search for, e.g. a tag number or clause reference.' },
      },
      required: ['query'],
    },
  },
};

const RETRIEVAL_TOOLS_OPENAI = [GET_PAGES_TOOL_OPENAI, SEARCH_TOOL_OPENAI];

function runToolOpenAI(name: string, args: { startPage?: unknown; endPage?: unknown; query?: unknown }, pageTexts: string[], pagesUsed: Set<number>): string {
  if (name === 'search_document') return searchDocument(pageTexts, args.query);
  return fetchPageRange(pageTexts, args.startPage, args.endPage, pagesUsed);
}

async function answerOpenAI(
  tree: IPageIndexNode[],
  docSummary: string,
  pageTexts: string[],
  question: string,
  history: ChatTurn[],
): Promise<{ answer: string; pagesUsed: number[] }> {
  const ai = getOpenAI();
  const pagesUsed = new Set<number>();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemInstruction(tree, docSummary) },
    ...history.map(h => ({ role: h.role === 'model' ? 'assistant' as const : 'user' as const, content: h.text })),
    { role: 'user', content: question },
  ];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const res = await ai.chat.completions.create({
      model: OPENAI_MODEL,
      messages,
      tools: RETRIEVAL_TOOLS_OPENAI,
      // Force at least one real lookup before the model is allowed to answer —
      // otherwise it tends to just paraphrase the structure summaries.
      tool_choice: turn === 0 ? 'required' : 'auto',
    });

    const msg = res.choices[0].message;
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { answer: msg.content?.trim() ?? '', pagesUsed: [...pagesUsed].sort((a, b) => a - b) };
    }

    messages.push({ role: 'assistant', content: msg.content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      if (call.type !== 'function') continue;
      const args = JSON.parse(call.function.arguments || '{}') as { startPage?: unknown; endPage?: unknown; query?: unknown };
      const output = runToolOpenAI(call.function.name, args, pageTexts, pagesUsed);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }

  return {
    answer:    'I could not narrow this down within the allowed number of lookups — try asking a more specific question.',
    pagesUsed: [...pagesUsed].sort((a, b) => a - b),
  };
}

export async function answerFromPageIndex(
  tree:       IPageIndexNode[],
  docSummary: string,
  pageTexts:  string[],
  question:   string,
  history:    ChatTurn[],
  provider:   LlmProvider,
): Promise<{ answer: string; pagesUsed: number[] }> {
  return provider === 'openai'
    ? answerOpenAI(tree, docSummary, pageTexts, question, history)
    : answerGemini(tree, docSummary, pageTexts, question, history);
}
