import { GoogleGenAI, Type } from '@google/genai';
import type { ITagItem } from '../models/Stage4Work';

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TagExtractionResult {
  tags:            ITagItem[];
  extractionNotes: string;
}

// ─── Gemini response schema ───────────────────────────────────────────────────

const TAG_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tagNumber: {
      type: Type.STRING,
      description: 'TAG number, serial number, or model number. Use "not specified" if not found.',
    },
    productName: {
      type: Type.STRING,
      description: 'Equipment or product name / description. Use "not specified" if not found.',
    },
    dimensions: {
      type: Type.STRING,
      description: 'Physical dimensions or size (e.g., "ID 600mm × L 3000mm", "600x400x300 mm"). Use "not specified" if not found.',
    },
    weightPerUnit: {
      type: Type.STRING,
      description: 'Weight per unit with units (e.g., "850 kg", "1.2 t"). Use "not specified" if not found.',
    },
    quantity: {
      type: Type.STRING,
      description: 'Number of units and unit type (e.g., "4", "2 sets", "6 nos"). Use "not specified" if not found.',
    },
    notes: {
      type: Type.STRING,
      description: 'Any additional information from the same row — material grade, design pressure, service fluid, etc. Leave empty string if nothing extra.',
    },
    missingFields: {
      type: Type.ARRAY,
      description: 'List of field names (tagNumber, productName, dimensions, weightPerUnit, quantity) that were explicitly not found in the document.',
      items: { type: Type.STRING },
    },
  },
  required: ['tagNumber', 'productName', 'dimensions', 'weightPerUnit', 'quantity', 'notes', 'missingFields'],
};

const TAGLIST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tags: {
      type: Type.ARRAY,
      description: 'One entry per equipment item / tag found in the document.',
      items: TAG_ITEM_SCHEMA,
    },
    extractionNotes: {
      type: Type.STRING,
      description: 'Brief note about extraction quality — e.g. how many tables were found, ambiguous entries, or confidence level. Keep under 2 sentences.',
    },
  },
  required: ['tags', 'extractionNotes'],
};

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractTagList(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {
  const ai = getClient();

  const prompt =
    `You are an equipment estimator reading a procurement document for inquiry ${inquiryId} ` +
    `(scope: ${scope}, document: "${documentTitle}").\n\n` +
    `Your task: extract the complete tag list / equipment list / bill of materials from this document.\n\n` +
    `For EACH line item (equipment, instrument, valve, vessel, skid, etc.), extract:\n` +
    `  1. tagNumber     — TAG number, serial number, or model number (e.g. "E-1001A", "V-101", "PL-001")\n` +
    `  2. productName   — Equipment name or description (e.g. "Pig Launcher", "Heat Exchanger", "Control Valve")\n` +
    `  3. dimensions    — Physical size or envelope dimensions (e.g. "ID 600mm × L 3000mm", "600×400×300 mm")\n` +
    `  4. weightPerUnit — Weight per single unit, with units (e.g. "850 kg", "1.2 t")\n` +
    `  5. quantity      — Number of units, with unit type (e.g. "4", "2 sets", "6 nos")\n\n` +
    `IMPORTANT rules:\n` +
    `- If a field is NOT mentioned or CANNOT be determined for a row, use the string "not specified".\n` +
    `- Also list that field's name in the missingFields array (e.g. ["dimensions", "weightPerUnit"]).\n` +
    `- Do NOT invent or guess values — only extract what is explicitly stated in the document.\n` +
    `- Include ALL line items found, even if most fields are missing.\n` +
    `- If the document has multiple tag list tables, merge them into one flat list.\n` +
    `- Put any additional row-level information (material grade, design pressure, service, etc.) in the notes field.`;

  const response = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   TAGLIST_SCHEMA,
    },
  });

  const raw = JSON.parse(response.text ?? '{}') as TagExtractionResult;

  // Ensure missingFields is always an array
  raw.tags = (raw.tags ?? []).map((t) => ({
    ...t,
    missingFields: Array.isArray(t.missingFields) ? t.missingFields : [],
  }));

  return raw;
}
