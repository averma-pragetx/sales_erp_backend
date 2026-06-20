import { GoogleGenAI, Type } from '@google/genai';

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TagListInput {
  tagNumber:    string;
  productName:  string;
  dimensions:   string;
  weightPerUnit: string;
  quantity:     string;   // raw string from Stage 4 ("4 nos", "not specified", etc.)
  notes:        string;
}

export interface PricedItem {
  tagNumber:        string;
  productName:      string;
  quantity:         number;   // parsed numeric quantity
  quantityUnit:     string;
  estimatedRateInr: number;
  rationale:        string;
  confidence:       string;   // "high" | "medium" | "low"
}

export interface PricingResult {
  items: PricedItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseQuantity(raw: string): { qty: number; unit: string } {
  if (!raw || raw.toLowerCase() === 'not specified') return { qty: 1, unit: 'nos' };
  const numMatch  = raw.match(/(\d+(?:\.\d+)?)/);
  const unitMatch = raw.replace(/[\d.,]/g, '').trim();
  return {
    qty:  numMatch ? parseFloat(numMatch[1]) : 1,
    unit: unitMatch || 'nos',
  };
}

// ─── Gemini response schema ───────────────────────────────────────────────────

const PRICING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      description: 'One entry per input item, in the same order as the input list.',
      items: {
        type: Type.OBJECT,
        properties: {
          estimatedRateInr: {
            type: Type.NUMBER,
            description: 'Estimated ex-works market price per unit in Indian Rupees (INR). Integer value.',
          },
          rationale: {
            type: Type.STRING,
            description: 'One-sentence reasoning behind the estimate (material, complexity, market rate).',
          },
          confidence: {
            type: Type.STRING,
            description: '"high" if well-known standard item, "medium" if approximate, "low" if highly uncertain.',
          },
        },
        required: ['estimatedRateInr', 'rationale', 'confidence'],
      },
    },
  },
  required: ['items'],
};

// ─── Main estimation function ─────────────────────────────────────────────────

export async function estimateBom(
  inquiryId: string,
  scope:     string,
  tags:      TagListInput[],
): Promise<PricingResult> {
  const ai = getClient();

  const itemLines = tags.map((t, i) =>
    `${i + 1}. Product: ${t.productName}\n` +
    `   TAG/Model: ${t.tagNumber}\n` +
    `   Dimensions: ${t.dimensions}\n` +
    `   Weight/unit: ${t.weightPerUnit}\n` +
    `   Quantity: ${t.quantity}\n` +
    (t.notes ? `   Notes: ${t.notes}\n` : ''),
  ).join('\n');

  const prompt =
    `You are an experienced cost estimator for industrial process equipment in India, ` +
    `working for an equipment manufacturing/procurement company (Oswal Engineering).\n\n` +
    `Inquiry: ${inquiryId} — Scope: ${scope}\n\n` +
    `Estimate the ex-works market price in Indian Rupees (INR) for each item below. ` +
    `Use your knowledge of Indian fabrication costs, imported equipment duties, steel prices, ` +
    `machining rates, and typical EPC project rates as of 2025-2026.\n` +
    `Provide the RATE PER UNIT only (not the total). Even for uncertain items give a best-effort estimate.\n\n` +
    `Items to price (${tags.length} total):\n\n${itemLines}\n` +
    `Return exactly ${tags.length} entries in the items array, in the same order as above.`;

  const response = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: [{ text: prompt }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   PRICING_SCHEMA,
    },
  });

  const raw = JSON.parse(response.text ?? '{}') as { items: { estimatedRateInr: number; rationale: string; confidence: string }[] };

  // Merge Gemini response back with original tag data (matched by index)
  const items: PricedItem[] = tags.map((t, i) => {
    const priced = raw.items?.[i] ?? { estimatedRateInr: 0, rationale: '', confidence: 'low' };
    const { qty, unit } = parseQuantity(t.quantity);
    return {
      tagNumber:        t.tagNumber === 'not specified' ? '' : t.tagNumber,
      productName:      t.productName === 'not specified' ? `Item ${i + 1}` : t.productName,
      quantity:         qty,
      quantityUnit:     unit,
      estimatedRateInr: Math.round(Math.max(0, priced.estimatedRateInr ?? 0)),
      rationale:        priced.rationale ?? '',
      confidence:       priced.confidence ?? 'low',
    };
  });

  return { items };
}
