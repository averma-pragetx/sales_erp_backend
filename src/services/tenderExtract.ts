import { GoogleGenAI, Type } from '@google/genai';

function getGemini(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

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
