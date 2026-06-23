import { GoogleGenAI, Type } from '@google/genai';

// ─── Response shape (mirrors the JSON schema below) ──────────────────────────

export interface ExtractionSection {
  title:   string;
  content: string;
  summary: string;
}

export interface ExtractionResult {
  overview:  string;
  keyItems:  string[];
  sections:  ExtractionSection[];
}

// ─── Structured JSON schema sent to Gemini ────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overview: {
      type: Type.STRING,
      description:
        'Two sentences max. What is being procured, by whom, and the single most critical constraint. Under 50 words total.',
    },
    keyItems: {
      type: Type.ARRAY,
      description:
        'Exactly 6 bullet strings (no more). Each under 15 words. Cover: scope, TAG numbers, quantity, delivery date, payment terms, bid deadline.',
      items: { type: Type.STRING },
    },
    sections: {
      type: Type.ARRAY,
      description:
        'Up to 8 sections covering: Scope of Supply, Equipment Tag List, Design Conditions, Codes & Standards, Material Specs, Inspection & Testing, Commercial Terms, Vendor Data Requirements. Include every section present in the document up to this limit.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Section heading. Under 10 words.',
          },
          content: {
            type: Type.STRING,
            description: 'Detailed extraction of the key requirements, conditions, and specifications from this section. 80-100 words.',
          },
          summary: {
            type: Type.STRING,
            description: 'Actionable summary for the sales/estimation team covering what to check, quote, or clarify. 80-100 words.',
          },
        },
        required: ['title', 'content', 'summary'],
      },
    },
  },
  required: ['overview', 'keyItems', 'sections'],
};

// ─── Client ───────────────────────────────────────────────────────────────────

// Singleton — one client per process, not one per request
let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in env.');
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractDocument(
  base64Data: string,
  mimeType:   string,
  docType:    string,
  scope:      string,
  inquiryId:  string,
): Promise<ExtractionResult> {
  const ai = getClient();

  const prompt =
    `You are a senior procurement and engineering document analyst with deep expertise in EPC projects, ` +
    `heat exchangers, pressure vessels, and industrial equipment RFQ packages.\n\n` +
    `Analyze this ${docType} document for inquiry ${inquiryId} (scope: ${scope}). ` +
    `Read it fully. Extract EVERY commercially and technically significant piece of information. ` +
    `Be comprehensive — miss nothing important. Summarize each value concisely; never paste raw walls of text verbatim.\n\n` +
    `Return a JSON object with exactly three fields — overview, keyItems, sections — as described below.\n\n` +
    `overview: Two to three sentences covering: what is being procured, by whom (client/EPC), ` +
    `project reference, key design basis, and the single most critical commercial constraint (bid date, budget, delivery).\n\n` +
    `keyItems: Exactly 6 bullet strings, each under 20 words. Cover the six most critical facts: ` +
    `scope summary, TAG numbers and quantities, applicable codes/standards, key design conditions (pressure/temperature/material), ` +
    `delivery period, and bid/payment terms.\n\n` +
    `sections: Up to 8 sections capturing the most commercially significant content. ` +
    `Include ALL of the following that are present in the document — do not skip any: ` +
    `Scope of Supply, Equipment Tag List, Design Conditions & Datasheets, ` +
    `Applicable Codes & Standards, Material Specifications, ` +
    `Inspection & Testing Requirements, Commercial Terms (bid date / delivery / payment / LD), ` +
    `Vendor Data Requirements, Quality Requirements, Referenced Documents, Critical Flags & Gaps. ` +
    `For each section: title = exact section name (under 10 words); ` +
    `content = detailed extraction of all key requirements, specs, conditions, and data points from that section — write 80 to 100 words, be thorough; ` +
    `summary = actionable summary for the sales/estimation team covering what to verify, quote, or clarify — write 80 to 100 words.`;

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Data } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   RESPONSE_SCHEMA,
      maxOutputTokens:  16000,
      temperature: 0.7
    },
  });

  let raw = '';
  for await (const chunk of stream) {
    raw += chunk.text || '';
  }

  raw = raw.trim();
  if (!raw) throw new Error('Gemini returned an empty response. Check your API key and model access.');

  const result = JSON.parse(raw) as Partial<ExtractionResult>;

  return {
    overview: result.overview  ?? '',
    keyItems: result.keyItems  ?? [],
    sections: (result.sections ?? []).map(s => ({
      title:   s.title   ?? '',
      content: s.content ?? '',
      summary: s.summary ?? '',
    })),
  };
}
