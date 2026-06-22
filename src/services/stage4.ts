import OpenAI from 'openai';
import * as pdfParseModule from 'pdf-parse';
// pdf-parse ships a CJS default export; normalise for both ESM and CJS hosts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (pdfParseModule as any).default ?? pdfParseModule;
import type { ITagItem } from '../models/Stage4Work';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
  return new OpenAI({ apiKey });
}

export interface TagExtractionResult {
  tags: ITagItem[];
  extractionNotes: string;
}

const SYSTEM_PROMPT =
  `You are an equipment estimator extracting a tag list from a procurement document. ` +
  `Respond ONLY with valid JSON matching this structure:\n` +
  `{\n` +
  `  "tags": [\n` +
  `    {\n` +
  `      "tagNumber": "string",\n` +
  `      "productName": "string",\n` +
  `      "dimensions": "string",\n` +
  `      "weightPerUnit": "string",\n` +
  `      "quantity": "string",\n` +
  `      "notes": "string",\n` +
  `      "missingFields": ["string"]\n` +
  `    }\n` +
  `  ],\n` +
  `  "extractionNotes": "string"\n` +
  `}\n` +
  `Use "not specified" for missing field values. ` +
  `List the field name in missingFields when a value is not found. ` +
  `Do NOT invent values — only extract what is explicitly stated.`;

export async function extractTagList(
  buffer: Buffer,
  mimeType: string,
  inquiryId: string,
  documentTitle: string,
  scope: string,
): Promise<TagExtractionResult> {
  const ai = getClient();

  const taskDescription =
    `Extract the complete tag list / equipment list / BOM from this document.\n\n` +
    `Inquiry: ${inquiryId} | Document: "${documentTitle}" | Scope: ${scope}\n\n` +
    `For EACH line item extract: tagNumber, productName, dimensions, weightPerUnit, quantity, notes.\n` +
    `- Use "not specified" if a field is not found, and add the field name to missingFields.\n` +
    `- Include ALL line items found, even with mostly missing data.\n` +
    `- Merge multiple tag list tables into one flat list.\n` +
    `- Put extra row info (material, design pressure, service fluid, etc.) in notes.`;

  let messages: OpenAI.Chat.ChatCompletionMessageParam[];

  if (mimeType.startsWith('image/')) {
    // Vision path for image files
    const base64 = buffer.toString('base64');
    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: taskDescription },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ],
      },
    ];
  } else {
    // PDF / text path — extract text first, then send as text
    let docText: string;
    try {
      const parsed = await pdfParse(buffer);
      docText = parsed.text.trim();
      if (!docText) throw new Error('empty');
    } catch {
      docText = '(PDF text extraction failed — document may be scanned or encrypted.)';
    }

    messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `${taskDescription}\n\n--- DOCUMENT TEXT ---\n${docText.slice(0, 80000)}`,
      },
    ];
  }

  const res = await ai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    messages,
  });

  const raw = JSON.parse(res.choices[0].message.content ?? '{}') as TagExtractionResult;

  raw.tags = (raw.tags ?? []).map(t => ({
    ...t,
    missingFields: Array.isArray(t.missingFields) ? t.missingFields : [],
  }));

  return raw;
}
