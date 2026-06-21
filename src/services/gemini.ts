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
        'The 8 most commercially significant sections only (no more than 8). Skip boilerplate like definitions or general conditions.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Section heading. Under 10 words.',
          },
          content: {
            type: Type.STRING,
            description: 'One sentence. State the single most important requirement. Under 25 words.',
          },
          summary: {
            type: Type.STRING,
            description: 'One sentence action item for the sales team. Under 20 words.',
          },
        },
        required: ['title', 'content', 'summary'],
      },
    },
  },
  required: ['overview', 'keyItems', 'sections'],
};

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractDocument(
  buffer:    Buffer,
  mimeType:  string,
  docType:   string,
  scope:     string,
  inquiryId: string,
): Promise<ExtractionResult> {
  const ai         = getClient();
  const base64Data = buffer.toString('base64');

  const prompt =
    `You are a senior sales engineer at a pressure-vessel and heat-exchanger manufacturing company. ` +
    `Analyze this ${docType} document for inquiry ${inquiryId} (scope: ${scope}). ` +
    `Be EXTREMELY concise. Follow the character limits in the schema strictly. ` +
    `Return no more than 8 sections and 6 key items. ` +
    `Each field must be one short sentence only — never copy raw text from the document verbatim.`;

  const stream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
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
      maxOutputTokens:  65536,
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
