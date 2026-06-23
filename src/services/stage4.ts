import OpenAI from 'openai';
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfParseModule from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (pdfParseModule as any).default ?? pdfParseModule;
import type { ITagItem } from '../models/Stage4Work';

// ─── Clients ──────────────────────────────────────────────────────────────────

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
  return new OpenAI({ apiKey });
}

function getGemini(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TagExtractionResult {
  tags:            ITagItem[];
  extractionNotes: string;
}

// ─── Shared prompt text ───────────────────────────────────────────────────────

const TASK_INSTRUCTIONS = (inquiryId: string, documentTitle: string, scope: string) =>
  `Extract the complete tag list / equipment list / BOM from this document.\n\n` +
  `Inquiry: ${inquiryId} | Document: "${documentTitle}" | Scope: ${scope}\n\n` +
  `For EACH line item extract: tagNumber, productName, dimensions, weightPerUnit, quantity, notes.\n` +
  `- Use "not specified" if a field is not found, and add the field name to missingFields.\n` +
  `- Include ALL line items found, even with mostly missing data.\n` +
  `- Merge multiple tag list tables into one flat list.\n` +
  `- Put extra row info (material, design pressure, service fluid, etc.) in notes.\n\n` +
  `Respond ONLY with valid JSON:\n` +
  `{ "tags": [{ "tagNumber":"","productName":"","dimensions":"","weightPerUnit":"","quantity":"","notes":"","missingFields":[] }], "extractionNotes":"" }`;

// ─── Gemini schema (for scanned/image PDFs) ───────────────────────────────────

const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tagNumber:     { type: Type.STRING },
          productName:   { type: Type.STRING },
          dimensions:    { type: Type.STRING },
          weightPerUnit: { type: Type.STRING },
          quantity:      { type: Type.STRING },
          notes:         { type: Type.STRING },
          missingFields: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['tagNumber','productName','dimensions','weightPerUnit','quantity','notes','missingFields'],
      },
    },
    extractionNotes: { type: Type.STRING },
  },
  required: ['tags', 'extractionNotes'],
};

// ─── Gemini fallback (handles scanned PDFs / image-based documents) ───────────

async function extractWithGemini(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {
  const ai = getGemini();
  const base64 = buffer.toString('base64');

  const stream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { text: TASK_INSTRUCTIONS(inquiryId, documentTitle, scope) },
        { inlineData: { mimeType, data: base64 } },
      ],
    }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   GEMINI_SCHEMA,
      maxOutputTokens:  65536,
    },
  });

  let raw = '';
  for await (const chunk of stream) raw += chunk.text || '';
  return JSON.parse(raw.trim()) as TagExtractionResult;
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractTagList(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {

  // Image files → OpenAI vision directly
  if (mimeType.startsWith('image/')) {
    const ai  = getOpenAI();
    const b64 = buffer.toString('base64');
    const res = await ai.chat.completions.create({
      model:           'gpt-5.4',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an equipment estimator extracting a tag list. ' + TASK_INSTRUCTIONS(inquiryId, documentTitle, scope) },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail: 'high' } },
          ],
        },
      ],
    });
    const raw = JSON.parse(res.choices[0].message.content ?? '{}') as TagExtractionResult;
    return normalise(raw);
  }

  // PDF — try text extraction first
  let docText = '';
  try {
    const parsed = await pdfParse(buffer);
    docText = parsed.text.trim();
  } catch { /* fall through */ }

  // Scanned / encrypted PDF → Gemini (multimodal, reads the actual image)
  if (!docText) {
    const raw = await extractWithGemini(buffer, mimeType, inquiryId, documentTitle, scope);
    return normalise(raw);
  }

  // Text-based PDF → OpenAI with extracted text
  const ai  = getOpenAI();
  const res = await ai.chat.completions.create({
    model:           'gpt-5.4',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an equipment estimator extracting a tag list. Respond ONLY with valid JSON.' },
      { role: 'user',   content: `${TASK_INSTRUCTIONS(inquiryId, documentTitle, scope)}\n\n--- DOCUMENT TEXT ---\n${docText.slice(0, 80000)}` },
    ],
  });
  const raw = JSON.parse(res.choices[0].message.content ?? '{}') as TagExtractionResult;
  return normalise(raw);
}

function normalise(raw: TagExtractionResult): TagExtractionResult {
  return {
    extractionNotes: raw.extractionNotes ?? '',
    tags: (raw.tags ?? []).map(t => ({
      ...t,
      missingFields: Array.isArray(t.missingFields) ? t.missingFields : [],
    })),
  };
}
