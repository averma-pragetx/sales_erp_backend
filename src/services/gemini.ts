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
        '2–3 sentence plain-English summary: what is being procured, by whom, and the key constraint (timeline / spec / quantity).',
    },
    keyItems: {
      type: Type.ARRAY,
      description:
        '6–10 bullet strings a sales engineer must know: scope of supply, equipment TAG numbers, quantities, critical specs (P/T/material), delivery, payment terms, bid submission requirements, applicable codes & standards.',
      items: { type: Type.STRING },
    },
    sections: {
      type: Type.ARRAY,
      description: 'Every significant section or clause found in the document.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Exact section heading as it appears in the document.',
          },
          content: {
            type: Type.STRING,
            description: 'Key data points from this section, condensed to 3–5 sentences.',
          },
          summary: {
            type: Type.STRING,
            description:
              '1–2 sentence takeaway for the sales/estimation team: what action or awareness this section demands.',
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
    `Extract every significant section and identify all critical commercial and technical requirements ` +
    `that the estimation / sales team needs to prepare a competitive bid. ` +
    `Pay special attention to: scope of supply, quantities, TAG numbers, design codes, ` +
    `material specifications, inspection/testing requirements, delivery schedule, ` +
    `payment terms, bid validity, and any deviations from standard.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { text: prompt },
      {
        inlineData: {
          mimeType: mimeType as 'application/pdf',
          data:     base64Data,
        },
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   RESPONSE_SCHEMA,
    },
  });

  const result = JSON.parse(response.text ?? '{}') as ExtractionResult;
  return result;
}
