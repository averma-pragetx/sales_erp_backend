import { Type, FunctionCallingConfigMode } from '@google/genai';
import type OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';
import type { IPageIndexNode } from '../models/PageIndexTree';
import { getGemini, getOpenAI, GEMINI_MODEL, OPENAI_MODEL, type LlmProvider } from '../ai/clients';

export type { LlmProvider };

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
// here. Deepen only if a real document needs a 3rd level.
// Input cap is 600k chars (~150k tokens) — comfortably inside both models'
// context windows and enough for the vast majority of RFQ packages in one pass.
// Beyond that the tail gets sliced off; we flag it (qualityFlags) rather than
// silently dropping it. Upgrade path when real docs exceed this: a two-pass
// build (skeleton pass, then per-window detail pass).
const MAX_INPUT_CHARS = 600_000;

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

function numberPages(pageTexts: string[]): string {
  return pageTexts.map((t, i) => `<page_${i + 1}>\n${t}\n</page_${i + 1}>`).join('\n\n');
}

// ─── Tree quality validation (deterministic, no LLM) ─────────────────────────

const MIN_SUMMARY_WORDS = 20;
const MAX_SIBLING_OVERLAP_PAGES = 2; // small overlaps (shared intro pages) are fine; larger ones are suspicious

export function summarizeRanges(pages: number[]): string {
  if (pages.length === 0) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const out: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) { prev = sorted[i]; continue; }
    out.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = sorted[i];
  }
  out.push(start === prev ? `${start}` : `${start}–${prev}`);
  return out.join(', ');
}

export function validateTree(tree: IPageIndexNode[], pageCount: number, inputTruncated: boolean): string[] {
  const flags: string[] = [];

  if (inputTruncated) {
    flags.push(`Document exceeded the ${MAX_INPUT_CHARS.toLocaleString()}-char analysis limit — sections near the end of the document may be missing or approximate.`);
  }
  if (tree.length === 0) {
    flags.push('No sections were produced — the structure map is empty.');
    return flags;
  }

  // Per-node sanity: valid ranges, non-trivial summaries (sections + subsections)
  const allNodes: IPageIndexNode[] = [];
  for (const s of tree) { allNodes.push(s); for (const sub of s.nodes) allNodes.push(sub); }
  for (const n of allNodes) {
    if (n.startPage > n.endPage) flags.push(`"${n.title}" has startPage > endPage (${n.startPage}–${n.endPage}).`);
    if (n.startPage < 1 || n.endPage > pageCount) flags.push(`"${n.title}" page range ${n.startPage}–${n.endPage} falls outside 1–${pageCount}.`);
    const words = n.summary.trim().split(/\s+/).filter(Boolean).length;
    if (words < MIN_SUMMARY_WORDS) flags.push(`"${n.title}" has a very short summary (${words} word${words === 1 ? '' : 's'}).`);
  }

  // Coverage + overlap across top-level sections
  const covered = new Array<number>(pageCount + 1).fill(0);
  for (const s of tree) {
    for (let p = Math.max(1, s.startPage); p <= Math.min(pageCount, s.endPage); p++) covered[p]++;
  }
  const gaps: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (covered[p] === 0) gaps.push(p);
  if (gaps.length) flags.push(`${gaps.length} page(s) not covered by any section: ${summarizeRanges(gaps)}.`);

  const secs = [...tree].sort((a, b) => a.startPage - b.startPage);
  for (let i = 1; i < secs.length; i++) {
    const overlap = secs[i - 1].endPage - secs[i].startPage + 1;
    if (overlap > MAX_SIBLING_OVERLAP_PAGES) {
      flags.push(`Sections "${secs[i - 1].title}" and "${secs[i].title}" overlap by ${overlap} pages.`);
    }
  }

  return flags;
}

function buildTreeInstructions(pageTexts: string[], docTitle: string): string {
  const numbered = numberPages(pageTexts).slice(0, MAX_INPUT_CHARS);

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

function parseTreeJson(raw: string, provider: string): RawTree {
  try {
    return JSON.parse(raw) as RawTree;
  } catch (err) {
    throw new Error(
      `${provider} returned malformed tree JSON (${(err as Error).message}). This usually means the response ` +
      `was cut off before finishing — the document likely has more sections than fit in the output token budget.`,
    );
  }
}

async function callTreeGemini(instructions: string): Promise<RawTree> {
  const ai = getGemini();

  const res = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: instructions }] }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   TREE_SCHEMA,
      maxOutputTokens:  65536,
    },
  });

  const finishReason = res.candidates?.[0]?.finishReason;
  if (finishReason === 'MAX_TOKENS') {
    throw new Error('Gemini hit the output token limit while building the tree — this document has too many sections to index in one pass.');
  }

  const raw = res.text?.trim();
  if (!raw) throw new Error('Gemini returned an empty tree.');
  return parseTreeJson(raw, 'Gemini');
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

async function callTreeOpenAI(instructions: string): Promise<RawTree> {
  const ai = getOpenAI();

  const res = await ai.chat.completions.create({
    model: OPENAI_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 32768,
    messages: [
      { role: 'system', content: TREE_JSON_SHAPE },
      { role: 'user', content: instructions },
    ],
  });

  if (res.choices[0].finish_reason === 'length') {
    throw new Error('OpenAI hit the output token limit while building the tree — this document has too many sections to index in one pass.');
  }

  const raw = res.choices[0].message.content;
  if (!raw) throw new Error('OpenAI returned an empty tree.');
  return parseTreeJson(raw, 'OpenAI');
}

async function runTreeCall(instructions: string, provider: LlmProvider): Promise<RawTree> {
  return provider === 'openai' ? callTreeOpenAI(instructions) : callTreeGemini(instructions);
}

function finalizeTree(raw: RawTree, pageTexts: string[]): { docSummary: string; tree: IPageIndexNode[]; qualityFlags: string[] } {
  const inputTruncated = numberPages(pageTexts).length > MAX_INPUT_CHARS;
  const tree = normalizeTree(raw.sections ?? [], pageTexts.length);
  return {
    docSummary:   raw.docSummary ?? '',
    tree,
    qualityFlags: validateTree(tree, pageTexts.length, inputTruncated),
  };
}

export async function buildPageIndexTree(
  pageTexts: string[],
  docTitle:  string,
  provider:  LlmProvider,
): Promise<{ docSummary: string; tree: IPageIndexNode[]; qualityFlags: string[] }> {
  const raw = await runTreeCall(buildTreeInstructions(pageTexts, docTitle), provider);
  return finalizeTree(raw, pageTexts);
}

// ─── Repair — targeted fix for validateTree's complaints, not a full rebuild ──
// ponytail: the "document exceeded analysis limit" flag is structural (input
// too big for one pass) and can't be patched by editing the tree — repair only
// targets the mechanically-fixable flags (gaps, overlaps, bad ranges, thin
// summaries). isFixableFlag() is how the route decides what to send here.

const STRUCTURAL_FLAG_PREFIX = 'Document exceeded';

export function isFixableFlag(flag: string): boolean {
  return !flag.startsWith(STRUCTURAL_FLAG_PREFIX);
}

function buildRepairInstructions(pageTexts: string[], docTitle: string, currentTree: IPageIndexNode[], flags: string[]): string {
  const numbered = numberPages(pageTexts).slice(0, MAX_INPUT_CHARS);

  return (
    `You previously built a table-of-contents-style structure map for "${docTitle}" (${pageTexts.length} pages). ` +
    `A validation pass found these issues with it:\n${flags.map(f => `- ${f}`).join('\n')}\n\n` +
    `Current structure map, JSON:\n${JSON.stringify(currentTree)}\n\n` +
    `Fix ONLY what's needed to resolve the listed issues — keep every section/subsection that isn't implicated ` +
    `exactly as it is (same title, pages, summary). Guidance per issue type:\n` +
    `- Uncovered pages: read what's actually on those pages below, then either extend the most relevant ` +
    `neighboring section to include them or add a new section — whichever matches the document's real structure.\n` +
    `- Short summaries: rewrite to 1-2 full sentences grounded in the actual page content, specific enough to ` +
    `judge relevance without reading the pages.\n` +
    `- Overlapping sections: move the boundary to the correct split point between them.\n` +
    `- Invalid page ranges: correct them to fall within 1–${pageTexts.length} with startPage <= endPage.\n\n` +
    `Return the COMPLETE corrected structure — every section, not just the ones you changed — covering the ` +
    `whole document. Read the page-tagged text below to make these decisions accurately.\n\n${numbered}`
  );
}

export async function repairPageIndexTree(
  pageTexts:   string[],
  docTitle:    string,
  currentTree: IPageIndexNode[],
  flags:       string[],
  provider:    LlmProvider,
): Promise<{ docSummary: string; tree: IPageIndexNode[]; qualityFlags: string[] }> {
  const raw = await runTreeCall(buildRepairInstructions(pageTexts, docTitle, currentTree, flags), provider);
  return finalizeTree(raw, pageTexts);
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
    `summaries alone; they are only a map for deciding where to look. You have a limited number of lookups per ` +
    `question, so target them well.\n\n` +
    `Tools:\n` +
    `- get_page_content(startPage, endPage): use once you've picked a specific relevant section/subsection from ` +
    `the structure above. Keep the range TIGHT — just the pages you need. Call it again for another range. If a ` +
    `result ends with a [TRUNCATED] notice, the range was too large: re-fetch a narrower range, or, if you ` +
    `already have enough, proceed but state in your answer that only part of that range was reviewed.\n` +
    `- search_document(query): use when the question names a specific term, tag/clause/item number, or value ` +
    `that a section summary might not mention, or when you are unsure which section covers it. If a search ` +
    `returns no matches, try 2–3 alternative phrasings (synonyms, abbreviations, singular/plural, with and ` +
    `without punctuation) before concluding the term is absent. Then use get_page_content on the matching ` +
    `page(s) to read full context before answering.\n\n` +
    `Answering:\n` +
    `- Your text reply is ALWAYS shown to the user as the final answer. Never write intentions or progress ` +
    `notes like "I will now search for..." — if you still need to look something up, call a tool instead of ` +
    `writing text.\n` +
    `- Quote exact figures, names, tags, and values verbatim from the fetched text — do not paraphrase loosely.\n` +
    `- Cite the specific page each fact came from, inline, e.g. "(p. 12)".\n` +
    `- If the fetched content doesn't actually answer the question, say so plainly instead of guessing or ` +
    `padding with generic commentary.`
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

export function searchDocument(pageTexts: string[], queryArg: unknown): string {
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
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    const res = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      // Turn 0 forces a real lookup (mode ANY) so the model can't just paraphrase
      // the summaries. The last turn drops tools entirely so the model must
      // synthesize a final answer from what it has, rather than getting cut off.
      config: isLastTurn
        ? { systemInstruction }
        : {
            systemInstruction,
            tools: [RETRIEVAL_TOOLS_GEMINI],
            toolConfig: turn === 0
              ? { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } }
              : undefined,
          },
    });

    const calls = res.functionCalls ?? [];
    if (calls.length === 0) {
      return {
        answer: res.text?.trim() || 'I was unable to find enough information in this document to answer confidently.',
        pagesUsed: [...pagesUsed].sort((a, b) => a - b),
      };
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
    answer:    'I was unable to find enough information in this document to answer confidently.',
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
    const isLastTurn = turn === MAX_TOOL_TURNS - 1;
    // Turn 0 forces a real lookup so the model can't just paraphrase the
    // summaries. The last turn drops tools so the model must synthesize a final
    // answer from what it has, rather than getting cut off mid-investigation.
    const res = await ai.chat.completions.create(
      isLastTurn
        ? { model: OPENAI_MODEL, messages }
        : { model: OPENAI_MODEL, messages, tools: RETRIEVAL_TOOLS_OPENAI, tool_choice: turn === 0 ? 'required' : 'auto' },
    );

    const msg = res.choices[0].message;
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return {
        answer: msg.content?.trim() || 'I was unable to find enough information in this document to answer confidently.',
        pagesUsed: [...pagesUsed].sort((a, b) => a - b),
      };
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
    answer:    'I was unable to find enough information in this document to answer confidently.',
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
