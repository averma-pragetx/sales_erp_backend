import OpenAI from 'openai';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
  return new OpenAI({ apiKey });
}

export interface TagListInput {
  tagNumber:     string;
  productName:   string;
  dimensions:    string;
  weightPerUnit: string;
  quantity:      string;
  notes:         string;
}

export interface PricedItem {
  tagNumber:        string;
  productName:      string;
  quantity:         number;
  quantityUnit:     string;
  estimatedRateInr: number;
  rationale:        string;
  confidence:       string;
}

export interface PricingResult {
  items: PricedItem[];
}

export function parseQuantity(raw: string): { qty: number; unit: string } {
  if (!raw || raw.toLowerCase() === 'not specified') return { qty: 1, unit: 'nos' };
  const numMatch  = raw.match(/(\d+(?:\.\d+)?)/);
  const unitMatch = raw.replace(/[\d.,]/g, '').trim();
  return {
    qty:  numMatch ? parseFloat(numMatch[1]) : 1,
    unit: unitMatch || 'nos',
  };
}

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

  const systemPrompt =
    `You are an experienced cost estimator for industrial process equipment in India. ` +
    `Respond ONLY with valid JSON: { "items": [{ "estimatedRateInr": number, "rationale": "string", "confidence": "high|medium|low" }] }. ` +
    `Return EXACTLY ${tags.length} items in the same order as the input. ` +
    `estimatedRateInr must be an integer (ex-works price per unit in INR). ` +
    `rationale is one sentence. confidence is "high", "medium", or "low".`;

  const userPrompt =
    `Inquiry: ${inquiryId} — Scope: ${scope}\n\n` +
    `Estimate the ex-works unit price in INR for each item. Use Indian fabrication costs, ` +
    `steel prices, machining rates, and EPC project rates as of 2025-2026. ` +
    `Rate per unit only (not total). Provide a best-effort estimate even for uncertain items.\n\n` +
    `Items (${tags.length} total):\n\n${itemLines}`;

  const res = await ai.chat.completions.create({
    model:           'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  });

  const raw = JSON.parse(res.choices[0].message.content ?? '{}') as {
    items: { estimatedRateInr: number; rationale: string; confidence: string }[];
  };

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
