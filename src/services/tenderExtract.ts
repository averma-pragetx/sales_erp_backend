import { Type } from '@google/genai';
import { getGemini } from '../ai/clients';

export interface TenderMeta {
  tenderId:  string;
  client:    string;
  title:     string;
  source:    string;
  value:     number;
  currency:  'USD' | 'INR';
  valueUnit: 'Mn' | 'Cr';
  dueDate:   string;
  score:     number;
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    tenderId:  { type: Type.STRING, description: 'Tender/NIT/enquiry reference number as printed on the document.' },
    client:    { type: Type.STRING, description: 'Procuring organization / client name.' },
    title:     { type: Type.STRING, description: 'Short tender title / subject line, under 15 words.' },
    source:    { type: Type.STRING, description: 'Portal or platform the tender was published on, e.g. CPPP, GeM, IREPS. Guess from letterhead/footer if not explicit.' },
    value:     { type: Type.NUMBER, description: 'Estimated tender/contract value as a plain number in the unit given by valueUnit.' },
    currency:  { type: Type.STRING, enum: ['USD', 'INR'] },
    valueUnit: { type: Type.STRING, enum: ['Mn', 'Cr'], description: 'Mn for millions, Cr for Indian crores. Use Cr for INR values, Mn for USD.' },
    dueDate:   { type: Type.STRING, description: 'Bid submission due date, ISO format YYYY-MM-DD.' },
    score:     {
      type: Type.INTEGER,
      description:
        'Integer fit score from 0 to 100 (never outside this range) for a heat exchanger / pressure vessel ' +
        'manufacturer bidding on this tender. Score it out of 100 across: scope match to heat exchangers / ' +
        'pressure vessels / process equipment (0-40 pts), estimated value size — larger is better (0-20 pts), ' +
        'bid deadline urgency — more lead time is better (0-20 pts), and document clarity/completeness (0-20 pts).',
    },
  },
  required: ['tenderId', 'client', 'title', 'source', 'value', 'currency', 'valueUnit', 'dueDate', 'score'],
};

export interface DocMeta {
  docType:  string;
  pages:    number;
  tenderNo: string;
  client:   string;
  package:  string;
  dueDate:  string;
  estValue: string;
  sections: string[];
}

const DOC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    docType:  { type: Type.STRING, description: 'Short document type label, e.g. RFQ, Datasheet, T&C, BOQ, Drawing.' },
    pages:    { type: Type.INTEGER, description: 'Total page count of the document.' },
    tenderNo: { type: Type.STRING, description: 'Tender/NIT/enquiry reference number printed on the document. Empty if absent.' },
    client:   { type: Type.STRING, description: 'Procuring organization / client name. Empty if absent.' },
    package:  { type: Type.STRING, description: 'Equipment package / scope summary, under 10 words. Empty if absent.' },
    dueDate:  { type: Type.STRING, description: 'Bid submission due date, ISO YYYY-MM-DD. Empty if absent.' },
    estValue: { type: Type.STRING, description: 'Estimated value exactly as printed (e.g. 4,20,00,000). Empty if absent.' },
    sections: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Top-level sections/contents of the document, each like "Section 1 — RFQ Document". Empty array if no clear structure.',
    },
  },
  required: ['docType', 'pages', 'tenderNo', 'client', 'package', 'dueDate', 'estValue', 'sections'],
};

export async function extractDocMeta(base64Data: string, mimeType: string): Promise<DocMeta> {
  const ai = getGemini();

  const prompt =
    `You are analyzing one document from a tender/RFQ package. Extract its metadata and table of contents ` +
    `per the schema. Leave fields empty ('' or []) when the document does not state them — do not invent values. ` +
    `Return ONLY the JSON object described by the schema.`;

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
      responseSchema:   DOC_SCHEMA,
      maxOutputTokens:  3000,
    },
  });

  let raw = '';
  for await (const chunk of stream) raw += chunk.text || '';
  raw = raw.trim();
  if (!raw) throw new Error('Gemini returned an empty response for document extraction.');

  const result = JSON.parse(raw) as Partial<DocMeta>;

  return {
    docType:  result.docType  ?? '',
    pages:    Math.max(0, Math.round(result.pages ?? 0)),
    tenderNo: result.tenderNo ?? '',
    client:   result.client   ?? '',
    package:  result.package  ?? '',
    dueDate:  result.dueDate  ?? '',
    estValue: result.estValue ?? '',
    sections: Array.isArray(result.sections) ? result.sections : [],
  };
}

export async function extractTenderMeta(base64Data: string, mimeType: string): Promise<TenderMeta> {
  const ai = getGemini();

  const prompt =
    `You are analyzing a tender/RFQ document scraped from a government or industrial procurement portal. ` +
    `Extract the tender ID, client (procuring organization), a short title, the source portal, the estimated ` +
    `value, and the bid due date. Also compute the fit score per the rubric in the schema — do the scoring ` +
    `yourself, do not leave it blank or default it. Return ONLY the JSON object described by the schema.`;

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
      responseSchema:   SCHEMA,
      maxOutputTokens:  2000,
    },
  });

  let raw = '';
  for await (const chunk of stream) raw += chunk.text || '';
  raw = raw.trim();
  if (!raw) throw new Error('Gemini returned an empty response for tender extraction.');

  const result = JSON.parse(raw) as Partial<TenderMeta>;

  return {
    tenderId:  result.tenderId  ?? '',
    client:    result.client    ?? '',
    title:     result.title     ?? '',
    source:    result.source    ?? '',
    value:     result.value     ?? 0,
    currency:  result.currency  === 'USD' ? 'USD' : 'INR',
    valueUnit: result.valueUnit === 'Mn'  ? 'Mn'  : 'Cr',
    dueDate:   result.dueDate   ?? '',
    score:     Math.max(0, Math.min(100, Math.round(result.score ?? 0))),
  };
}
