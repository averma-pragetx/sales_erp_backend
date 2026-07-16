import { Type } from '@google/genai';
import * as pdfParseModule from 'pdf-parse';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = (pdfParseModule as any).default ?? pdfParseModule;
import type { ITagItem, IExtractionMeta } from '../models/Stage4Work';

import { getGemini } from '../ai/clients';

export interface TagExtractionResult {
  tags:            ITagItem[];
  extractionMeta:  IExtractionMeta;
  extractionNotes: string;
}

// ─── Gemini response schema ───────────────────────────────────────────────────

const SIDE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fluid:                   { type: Type.STRING },
    operating_pressure_barg: { type: Type.NUMBER },
    design_pressure_barg:    { type: Type.NUMBER },
    operating_temp_c:        { type: Type.NUMBER },
    design_temp_c:           { type: Type.NUMBER },
    material:                { type: Type.STRING },
  },
};

const GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    extraction_meta: {
      type: Type.OBJECT,
      properties: {
        source_documents:           { type: Type.ARRAY, items: { type: Type.STRING } },
        total_tags_found:           { type: Type.INTEGER },
        total_units:                { type: Type.INTEGER },
        total_fabrication_weight_t: { type: Type.NUMBER },
      },
    },
    tag_list: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tag_number:        { type: Type.STRING },
          service:           { type: Type.STRING },
          tema_type:         { type: Type.STRING },
          shell_od_mm:       { type: Type.NUMBER },
          tube_length_mm:    { type: Type.NUMBER },
          nos:               { type: Type.INTEGER },
          shell_side:        SIDE_SCHEMA,
          tube_side:         SIDE_SCHEMA,
          weight_per_unit_t: { type: Type.NUMBER },
          total_weight_t:    { type: Type.NUMBER },
          datasheet_ref:     { type: Type.STRING },
          datasheet_rev:     { type: Type.STRING },
        },
        required: ['tag_number', 'service', 'tema_type', 'shell_od_mm', 'tube_length_mm', 'nos',
                   'shell_side', 'tube_side', 'weight_per_unit_t', 'total_weight_t',
                   'datasheet_ref', 'datasheet_rev'],
      },
    },
  },
  required: ['tag_list'],
};

// ─── Prompt (from step4_Tag_Datasheet.md — cost fields removed) ───────────────

const SYSTEM_PROMPT =
`You are a senior mechanical engineer and EPC procurement specialist with 20+ years experience in shell-and-tube heat exchangers and pressure vessels. You are extracting structured data from engineering datasheets to populate a procurement table.

YOUR OUTPUT IS USED FOR PROCUREMENT AND COST ESTIMATION — every field must contain a realistic, usable value. Blank or zero values are only acceptable for tag_number, datasheet_ref, and datasheet_rev when genuinely absent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE MANDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For every tag found in the document:
  1. Extract the value directly if it is stated anywhere in the document.
  2. If a value is not stated, DERIVE or ESTIMATE it using all available context:
       — other fields on the same datasheet (e.g. derive design pressure from operating pressure)
       — the service description and fluid names
       — the inquiry scope and project context
       — standard engineering practice and industry norms for this type of equipment
  3. An estimated value is always better than 0 or "". Estimates must be physically realistic and consistent with the rest of the datasheet data.
  4. Track estimation status: For crucial derived/estimated values, you must mark them as "estimated" in the designated boolean schema properties.
  5. NEVER fabricate tag numbers, datasheet references, or service names — copy those exactly.
  6. Return ONLY the raw JSON block matching the specified schema. Do not wrap the JSON in Markdown formatting or include conversational preambles/postscripts.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD INSTRUCTIONS & ESTIMATION HEURISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TAG NUMBER (tag_number) — COPY EXACTLY, never modify:
  • Look in: title block, "Tag No.", "Equipment No.", item number column, drawing title.
  • A/B or parallel shells under one tag → one entry, set nos = number of shells.
  • NEVER split "101-EE-0116A/B" into two entries.
  • If absent from document: use "".

SERVICE (service) — COPY EXACTLY:
  • Look in: "Service", "Description", "Duty", document title line.
  • e.g. "Propane Feed Vaporizer", "Overhead Condenser", "BFW Preheater".
  • If absent: use "".

TEMA TYPE (tema_type) — Extract, then derive, then estimate:
  • Step 1: Look for explicit "TEMA Type" or "Exchanger Type" field.
  • Step 2: Derive from front-head / shell / rear-head code boxes using:
       Front: A=channel+removable cover, B=bonnet, C=integral channel, N=fixed tubesheet end, D=special
       Shell:  E=one-pass, F=two-pass, G=split-flow, H=double-split, J=divided-flow, K=kettle, X=cross-flow
       Rear:   L=fixed(A-end), M=fixed(B-end), N=fixed(C-end), P=outside-packed, S=floating+backing device,
               T=pull-through bundle, U=U-tube, W=externally-sealed floating head
  • Step 3: If still unclear, estimate the most common type for this service:
       — Condensers / coolers (removable bundle needed): AES or BEM
       — Reboilers / vaporizers: AKT or BKU (kettle) or BEM
       — Feed-effluent / high-pressure: AES or BEU
       — Fixed tubesheet utility service: BEM or NEN
  • Never leave blank if it is a heat exchanger. Mark "tema_type_estimated": true if derived or estimated.

SHELL OD (shell_od_mm) & SHELL ID (shell_id_mm) — Extract, then estimate:
  • Look in: "Shell OD", "Shell ID", "Shell Diameter", "DN", nozzle schedule, dimension drawing.
  • If ID is given but not OD, capture the ID in "shell_id_mm" and estimate the OD using: OD ≈ ID + 2 × (ID/200 + 6) mm (round to nearest standard).
  • If both are absent, estimate OD from the heat duty or equipment size context. Typical range: 200–2000 mm.
    Common standard sizes: 203, 254, 305, 387, 438, 489, 540, 591, 635, 686, 737, 787, 838, 889, 940, 991, 1067 mm.
  • Always output a positive integer for OD. Never 0. If estimated, set "dimensions_estimated": true.

TUBE LENGTH (tube_length_mm) — Extract, then estimate:
  • Look in: "Tube Length", "Eff. Length", "Effective Tube Length".
  • If absent, use the most common standard length consistent with the shell size:
       Shell ≤ 400mm → typically 1500 or 2400 mm
       Shell 400–800mm → typically 3000 or 4500 mm
       Shell > 800mm → typically 4500 or 6000 mm
  • Always output a positive integer. Never 0. If estimated, set "dimensions_estimated": true.

NOS (nos):
  • Look in: "No. of Units", "NOS", "Qty", "No. Required", "Number of Shells".
  • Default 1 if a single-tag datasheet with no explicit count.

SHELL-SIDE / TUBE-SIDE CONDITIONS — Extract, then fill gaps:
  fluid:
    • Exact fluid name as written: "Propane (Liq)", "MP Steam", "Crude Oil", "Cooling Water".
    • If absent: derive from service name (e.g. "Overhead Condenser" → condensing hydrocarbon on shell side).
  operating_pressure_barg:
    • Look in: "Operating Pressure", "P_op", process tables.
    • If absent: estimate from process context (utility steam ≈ 3–10 barg, cooling water ≈ 3–6 barg).
    • Never 0 unless it is a vacuum or atmospheric vented service.
  design_pressure_barg:
    • Look in: "Design Pressure", "DP".
    • If absent: estimate as max(operating_pressure_barg × 1.1 + 1.75, operating_pressure_barg + 3.5) rounded to 1 decimal.
  operating_temp_c:
    • Use inlet temperature if a range is given (e.g. "150→120°C" → use 150).
    • If absent: estimate from service (steam condensing ≈ 120–180°C, cooling water ≈ 30–45°C).
  design_temp_c:
    • If absent: estimate as operating_temp_c + 25°C (minimum 50°C).
  material:
    • Full spec: "SA-516 Gr.70", "CS + 3mm CA", "316L SS", "SA-240 Gr.304", "SA-179" (tubes), "SA-213 TP316L" (tubes).
    • If absent: infer from fluid and temperature —
         CS or low-alloy steel for non-corrosive hydrocarbon services < 400°C,
         SS 304/316 for corrosive fluids or high-temperature steam,
         CS + corrosion allowance (3mm typical) for mildly corrosive services.
  • If any pressures, temperatures, or materials are estimated or derived, set "process_conditions_estimated": true.

WEIGHT PER UNIT (weight_per_unit_t) — Extract, then estimate:
  • Look in: "Weight", "Approx. Weight", "Fabrication Weight", "Erection Weight", "Shipping Weight".
  • Unit priority: operating weight > fabrication weight > dry weight. Convert kg → t (÷ 1000).
  • If absent, estimate using shell geometry:
       Approximate shell volume (m³) = π/4 × (shell_od_mm/1000)² × (tube_length_mm/1000)
       CS heat exchanger weight ≈ shell_volume × 1800 kg/m³
       Stainless or alloy: multiply by 1.15
       Round to 1 decimal place. Minimum 0.3 t for any real exchanger.
  • Never 0. If estimated, set "weight_estimated": true.

TOTAL WEIGHT (total_weight_t):
  • = weight_per_unit_t × nos. Always calculate.

DATASHEET REF & REV (datasheet_ref / datasheet_rev) — COPY EXACTLY:
  • Look in title blocks, header, or revision index. If absent: use "".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONSISTENCY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Every tag in the document MUST appear. Missing a tag is a critical failure.
• If the same tag spans multiple datasheet sheets, merge all data into one entry.
• design_pressure must always ≥ operating_pressure.
• design_temp must always ≥ operating_temp.
• total_weight_t must equal weight_per_unit_t × nos exactly.
• Pressures in barg; if document says psig convert: barg = (psig − 14.5) / 14.504.
• Temperatures in °C; if document says °F convert: °C = (°F − 32) / 1.8.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY SCHEMA STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Output must strictly adhere to this JSON structure:

{
  "source_documents": [],
  "total_tags_found": 0,
  "total_units": 0,
  "total_fabrication_weight_t": 0,
  "tags": [
    {
      "tag_number": "string",
      "service": "string",
      "tema_type": "string",
      "shell_id_mm": 0,
      "shell_od_mm": 0,
      "tube_length_mm": 0,
      "nos": 1,
      "shell_side": {
        "fluid": "string",
        "operating_pressure_barg": 0.0,
        "design_pressure_barg": 0.0,
        "operating_temp_c": 0.0,
        "design_temp_c": 0.0,
        "material": "string"
      },
      "tube_side": {
        "fluid": "string",
        "operating_pressure_barg": 0.0,
        "design_pressure_barg": 0.0,
        "operating_temp_c": 0.0,
        "design_temp_c": 0.0,
        "material": "string"
      },
      "weight_per_unit_t": 0.0,
      "total_weight_t": 0.0,
      "datasheet_ref": "string",
      "datasheet_rev": "string",
      "is_estimated_data": {
        "tema_type_estimated": false,
        "dimensions_estimated": false,
        "process_conditions_estimated": false,
        "weight_estimated": false
      }
    }
  ]
}
`;

const buildUserPrompt = (inquiryId: string, documentTitle: string, scope: string, docText?: string) =>
  `Inquiry: ${inquiryId} | Document: "${documentTitle}" | Scope: ${scope}\n\n` +
  (docText ? `--- DOCUMENT TEXT ---\n${docText.slice(0, 120000)}` : '');

// ─── Gemini multimodal (scanned PDFs, images) ─────────────────────────────────

async function extractMultimodal(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {
  const ai = getGemini();

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-flash-lite',
    contents: [{
      role: 'user',
      parts: [
        { text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(inquiryId, documentTitle, scope) },
        { inlineData: { mimeType, data: buffer.toString('base64') } },
      ],
    }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   GEMINI_SCHEMA,
      maxOutputTokens:  65536,
      temperature:      0.3,
    },
  });

  let raw = '';
  for await (const chunk of stream) raw += chunk.text || '';
  return normalise(JSON.parse(raw.trim()));
}

// ─── Gemini text (text-based PDFs) ───────────────────────────────────────────

async function extractFromText(
  docText:       string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {
  const ai = getGemini();

  const stream = await ai.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [{
        text: SYSTEM_PROMPT + '\n\n' + buildUserPrompt(inquiryId, documentTitle, scope, docText),
      }],
    }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   GEMINI_SCHEMA,
      maxOutputTokens:  65536,
    },
  });

  let raw = '';
  for await (const chunk of stream) raw += chunk.text || '';
  return normalise(JSON.parse(raw.trim()));
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractTagList(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  documentTitle: string,
  scope:         string,
): Promise<TagExtractionResult> {
  if (mimeType.startsWith('image/')) {
    return extractMultimodal(buffer, mimeType, inquiryId, documentTitle, scope);
  }

  let docText = '';
  try {
    const parsed = await pdfParse(buffer);
    docText = parsed.text.trim();
  } catch { /* fall through to multimodal */ }

  if (docText) {
    return extractFromText(docText, inquiryId, documentTitle, scope);
  }

  return extractMultimodal(buffer, mimeType, inquiryId, documentTitle, scope);
}

// ─── Normalise: map snake_case Gemini output → camelCase TypeScript model ─────

function normSide(s: Record<string, unknown> | undefined) {
  if (!s || typeof s !== 'object') {
    return { fluid: '', operatingPressureBarg: 0, designPressureBarg: 0, operatingTempC: 0, designTempC: 0, material: '' };
  }
  return {
    fluid:                 String(s.fluid ?? ''),
    operatingPressureBarg: Number(s.operating_pressure_barg ?? 0),
    designPressureBarg:    Number(s.design_pressure_barg ?? 0),
    operatingTempC:        Number(s.operating_temp_c ?? 0),
    designTempC:           Number(s.design_temp_c ?? 0),
    material:              String(s.material ?? ''),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any): TagExtractionResult {
  const meta  = raw?.extraction_meta ?? {};
  const items = Array.isArray(raw?.tag_list) ? raw.tag_list : [];

  const tags: ITagItem[] = items.map((t: Record<string, unknown>) => ({
    tagNumber:       String(t.tag_number      ?? ''),
    service:         String(t.service         ?? ''),
    temaType:        String(t.tema_type       ?? ''),
    shellOdMm:       Number(t.shell_od_mm     ?? 0),
    tubeLengthMm:    Number(t.tube_length_mm  ?? 0),
    nos:             Number(t.nos             ?? 1),
    shellSide:       normSide(t.shell_side as Record<string, unknown>),
    tubeSide:        normSide(t.tube_side  as Record<string, unknown>),
    weightPerUnitT:  Number(t.weight_per_unit_t ?? 0),
    totalWeightT:    Number(t.total_weight_t    ?? 0),
    datasheetRef:    String(t.datasheet_ref ?? ''),
    datasheetRev:    String(t.datasheet_rev ?? ''),
    ltcs:            false,
    ibr:             false,
    pwht:            false,
    ndeRequirements: [],
    deviations:      [],
    openItems:       [],
    specialNotes:    [],
  }));

  const extractionMeta: IExtractionMeta = {
    sourceDocuments:         Array.isArray(meta.source_documents) ? meta.source_documents.map(String) : [],
    totalTagsFound:          Number(meta.total_tags_found           ?? tags.length),
    totalUnits:              Number(meta.total_units                ?? 0),
    ltcsItemCount:           0,
    totalFabricationWeightT: Number(meta.total_fabrication_weight_t ?? 0),
  };

  return { tags, extractionMeta, extractionNotes: '' };
}
