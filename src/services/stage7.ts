import * as pdfParseModule from 'pdf-parse';
import {
  IEquipmentBom, IBomComponent, INozzle, IProjectInfo,
} from '../models/Stage7Work';

const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  (pdfParseModule as unknown as { default?: (buf: Buffer) => Promise<{ text: string }> }).default
  ?? (pdfParseModule as unknown as (buf: Buffer) => Promise<{ text: string }>);

import { getGemini as getClient } from '../ai/clients';

// ─── System prompt (from step6_BOM.md) ───────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior Mechanical Equipment Engineer and Estimation Specialist with expertise in:

- Shell & Tube Heat Exchangers
- TEMA Standards
- Mechanical Datasheets
- Material Requisitions
- Equipment Procurement Packages
- Bill of Materials (BOM) Extraction
- Nozzle Schedule Interpretation

A Purchase Requisition (PR) PDF has been provided.

The document may contain multiple equipment tags.

Each equipment tag may span multiple datasheet sheets including:

- Sht.1
- Sht.2
- Sht.3
- Additional continuation sheets

You MUST review ALL sheets belonging to a tag before extracting data.

==================================================
PRIMARY OBJECTIVE
==================================================

For EACH equipment tag:

1. Identify the equipment.
2. Extract the COMPLETE BOM.
3. Extract the COMPLETE Nozzle Schedule.
4. Maintain source traceability.

Accuracy is more important than completeness.

Never invent values.

Never estimate values.

==================================================
OUTPUT REQUIREMENTS
==================================================

Return ONLY valid JSON.

Do NOT return:

- Markdown
- Explanations
- Notes
- Comments
- Code fences

Output must be parseable by JSON.parse() without modification.

==================================================
OUTPUT SCHEMA
==================================================

{
  "project": {
    "name": string | null,
    "job_no": string | null,
    "client": string | null,
    "consultant": string | null,
    "pr_number": string | null,
    "revision": string | null,
    "date": string | null
  },

  "equipment": [
    {
      "tag_no": string,

      "service": string | null,

      "deleted_from_scope": boolean,

      "ibr_applicable": boolean,

      "hydrogen_service": boolean,

      "bom": [
        {
          "sr_no": string | null,

          "component": string,

          "applicable": "Yes" | "No",

          "moc": string | null,

          "moc_source":
            "datasheet" |
            "inferred" |
            "not_found",

          "moc_flag": string | null,

          "type_detail": string | null,

          "weight_kg": number | null,

          "quantity": string | null,

          "unit": string | null,

          "source_page": number | null,

          "source_sheet": string | null,

          "remarks": string
        }
      ],

      "nozzle_schedule": [
        {
          "mark": string | null,

          "size_nps": string | null,

          "asme_class": string | null,

          "schedule": string | null,

          "facing": string | null,

          "designation": string | null,

          "moc_neck": string | null,

          "moc_flange": string | null,

          "moc_flag": string | null,

          "source_page": number | null,

          "source_sheet": string | null
        }
      ]
    }
  ]
}

==================================================
DOCUMENT PROCESSING RULES
==================================================

1. Process the ENTIRE document.

2. Identify every equipment tag.

3. Treat every tag as a separate equipment object.

4. Never merge data from different tags.

5. Review ALL sheets belonging to a tag before generating output.

6. Information may be distributed across multiple sheets.

7. Do not assume a value is missing until all sheets for that tag have been reviewed.

==================================================
BOM EXTRACTION RULES
==================================================

This is the highest priority task.

Extract EVERY row from the Mechanical Details table.

Do NOT skip rows because:

- Applicable = No
- Weight missing
- Quantity missing
- MOC missing
- Component appears unimportant

If a row exists in the datasheet, it MUST appear in the output.

Examples include but are not limited to:

- Shell
- Channel
- Channel Cover
- Tubesheet
- Tubes
- Floating Head
- Floating Head Cover
- Baffles
- Support Plates
- Tie Rods
- Spacers
- Impingement Plate
- Pass Partition Plate
- Saddle
- Expansion Joint
- Gasket
- Bolting
- Lifting Lug
- Any other listed component

Never create BOM rows that do not exist.

Never omit BOM rows that do exist.

==================================================
MOC EXTRACTION RULES
==================================================

For every BOM component:

STEP 1:
Search Mechanical Details table.

STEP 2:
Search Material of Construction table.

STEP 3:
Search Notes.

STEP 4:
Search continuation sheets.

STEP 5:
Match BOM component against MOC entries.

If explicit MOC exists:

moc_source = "datasheet"

If MOC is inferred from a clearly corresponding entry:

moc_source = "inferred"

moc_flag must explain the inference.

If MOC is not available:

moc = null

moc_source = "not_found"

moc_flag =
"NOT STATED IN DOCUMENT - VERIFY FROM MATERIAL REQUISITION OR VENDOR DOCUMENTATION"

Never leave moc_flag null when:

- moc_source = "inferred"
- moc_source = "not_found"

==================================================
WEIGHT RULES
==================================================

Extract only from actual weight columns.

Examples:

- Wt(Kg)
- Weight(Kg)
- Weight

If weight is absent:

weight_kg = null

Do not calculate.

Do not estimate.

==================================================
QUANTITY RULES
==================================================

Extract exactly as written.

Examples:

1
2
4
AR
AS REQD
N/A

Do not modify.

Do not calculate.

==================================================
TYPE DETAIL RULES
==================================================

Extract descriptions exactly as written.

Examples:

- Integral Forged
- Packed Floating Head
- U-Tube Bundle
- Floating Tube Sheet

Do not summarize.

Do not infer.

==================================================
NOZZLE SCHEDULE RULES
==================================================

Locate the complete Nozzle Schedule table.

Usually found on Sht.1.

Extract EVERY row.

Create ONE nozzle object per row.

Do not merge rows.

Do not skip rows.

Extract exactly as written:

- Nozzle Mark
- Size
- Class
- Schedule
- Facing
- Designation
- MOC Neck
- MOC Flange

Preserve original values exactly.

If a field is blank:

set null.

Do not infer missing nozzle values.

==================================================
SOURCE TRACEABILITY RULES
==================================================

For every BOM row:

populate:

- source_page
- source_sheet

For every nozzle row:

populate:

- source_page
- source_sheet

This information is mandatory whenever available.

==================================================
SCOPE RULES
==================================================

deleted_from_scope = true

ONLY if explicitly stated.

Examples:

- Deleted
- Removed from Scope
- Not in Vendor Scope

Otherwise false.

ibr_applicable = true

ONLY if IBR applicability is explicitly stated.

Otherwise false.

hydrogen_service = true

ONLY if hydrogen service is explicitly stated.

Otherwise false.

==================================================
FINAL VALIDATION
==================================================

Before returning the JSON:

1. Verify every equipment tag has been processed.

2. Verify every BOM row from the datasheet exists in output.

3. Verify every nozzle row from the nozzle schedule exists in output.

4. Verify all missing values are null.

5. Verify no values were estimated.

6. Verify output is valid JSON.

Return ONLY the JSON.`;


function buildUserPrompt(inquiryId: string, scope: string, stage4Context: string): string {
  return [
    `INQUIRY: ${inquiryId}`,
    `SCOPE: ${scope}`,
    '',
    'STAGE 4 EXTRACTED TAG LIST (cross-reference only):',
    stage4Context,
    '',
    'Extract the complete BOM from the attached purchase requisition document. Return valid JSON.',
  ].join('\n');
}

// ─── Normalise helpers ────────────────────────────────────────────────────────

function str(v: unknown): string { return (v === null || v === undefined) ? '' : String(v).trim(); }
function num(v: unknown): number { const n = Number(v); return isNaN(n) ? 0 : n; }
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v); return isNaN(n) ? null : n;
}
function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function normComp(raw: Record<string, unknown>): IBomComponent {
  const moc     = str(raw.moc) || null;
  const mocSrc  = str(raw.moc_source) || 'not_found';
  const rawFlag = str(raw.moc_flag);
  return {
    srNo:       str(raw.sr_no),
    component:  str(raw.component),
    applicable: str(raw.applicable) || 'Yes',
    moc,
    mocSource:  mocSrc,
    mocFlag:    rawFlag || (moc === null ? 'NOT STATED IN DOCUMENT — obtain from MSD before procurement' : null),
    typeDetail: str(raw.type_detail) || null,
    remarks:    str(raw.remarks),
    weightKg:        numOrNull(raw.weight_kg),
    quantity:        str(raw.quantity),
    unit:            str(raw.unit),
    unitCostPerKg:   null,
    materialCost:    null,
    fabricationCost: null,
    totalCost:       null,
    costBasis:       null,
  };
}

function normNozzle(raw: Record<string, unknown>): INozzle {
  return {
    mark:        str(raw.mark),
    sizeNps:     str(raw.size_nps),
    asmeClass:   str(raw.asme_class),
    schedule:    str(raw.schedule),
    facing:      str(raw.facing),
    designation: str(raw.designation),
    mocNeck:     str(raw.moc_neck) || null,
    mocFlange:   str(raw.moc_flange) || null,
    mocFlag:     str(raw.moc_flag) || null,
    totalCost:   null,
    costBasis:   null,
  };
}

function normEquipment(raw: Record<string, unknown>): IEquipmentBom {
  return {
    tagNo:                     str(raw.tag_no),
    service:                   str(raw.service),
    temaClass:                 str(raw.tema_class),
    exchangerType:             str(raw.exchanger_type),
    sizeIdMm:                  num(raw.size_id_mm),
    sizeSlMm:                  num(raw.size_sl_mm),
    noOfShells:                num(raw.no_of_shells) || 1,
    noOfPassesShell:           num(raw.no_of_passes_shell) || 1,
    noOfPassesTube:            num(raw.no_of_passes_tube) || 1,
    designPressureShell:       str(raw.design_pressure_shell),
    designPressureTube:        str(raw.design_pressure_tube),
    designTempShellC:          num(raw.design_temp_shell_C),
    designTempTubeC:           num(raw.design_temp_tube_C),
    fluidShell:                str(raw.fluid_shell),
    fluidTube:                 str(raw.fluid_tube),
    corrosionAllowanceShellMm: num(raw.corrosion_allowance_shell_mm),
    corrosionAllowanceTubeMm:  num(raw.corrosion_allowance_tube_mm),
    stressRelieving:           str(raw.stress_relieving),
    radiography:               str(raw.radiography),
    bundleWeightKg:            numOrNull(raw.bundle_weight_kg),
    emptyWeightKg:             numOrNull(raw.empty_weight_kg),
    fullWaterWeightKg:         numOrNull(raw.full_water_weight_kg),
    deletedFromScope:          bool(raw.deleted_from_scope),
    ibrApplicable:             bool(raw.ibr_applicable),
    hydrogenService:           bool(raw.hydrogen_service),
    bom:                  Array.isArray(raw.bom) ? (raw.bom as Record<string, unknown>[]).map(normComp) : [],
    nozzleSchedule:       Array.isArray(raw.nozzle_schedule) ? (raw.nozzle_schedule as Record<string, unknown>[]).map(normNozzle) : [],
    totalMaterialCost:    null,
    totalFabricationCost: null,
    totalNozzleCost:      null,
    specialCost:          null,
    inspectionCost:       null,
    totalEquipCost:       null,
  };
}

export interface BomExtractionResult {
  projectInfo: IProjectInfo;
  equipment:   IEquipmentBom[];
}

function normalise(parsed: Record<string, unknown>): BomExtractionResult {
  const proj = (parsed.project as Record<string, unknown>) ?? {};
  const projectInfo: IProjectInfo = {
    name:       str(proj.name),
    jobNo:      str(proj.job_no),
    client:     str(proj.client),
    consultant: str(proj.consultant),
    prNumber:   str(proj.pr_number),
    revision:   str(proj.revision),
    date:       str(proj.date),
  };
  const equipment = Array.isArray(parsed.equipment)
    ? (parsed.equipment as Record<string, unknown>[]).map(normEquipment)
    : [];
  return { projectInfo, equipment };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function extractBom(
  buffer:        Buffer,
  mimeType:      string,
  inquiryId:     string,
  scope:         string,
  stage4Context: string,
): Promise<BomExtractionResult> {
  const ai         = getClient();
  const userPrompt = buildUserPrompt(inquiryId, scope, stage4Context);

  let docText = '';
  if (mimeType === 'application/pdf') {
    try {
      const parsed = await pdfParse(buffer);
      if (parsed.text.trim().length > 200) docText = parsed.text;
    } catch { /* fall through to multimodal */ }
  }

  const cfg = {
    systemInstruction: SYSTEM_PROMPT,
    responseMimeType:  'application/json' as const,
    maxOutputTokens:   65536,
    temperature:       0.1,
  };

  let rawJson = '';
  if (docText.length > 200) {
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: cfg,
      contents: [{ role: 'user', parts: [{ text: `${userPrompt}\n\nDOCUMENT TEXT:\n${docText}` }] }],
    });
    rawJson = result.text ?? '';
  } else {
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: cfg,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: (mimeType || 'application/pdf') as 'application/pdf', data: buffer.toString('base64') } },
          { text: userPrompt },
        ],
      }],
    });
    rawJson = result.text ?? '';
  }

  const clean = rawJson.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Gemini returned invalid JSON for Stage 7: ${String(e)}\nRaw (first 500): ${clean.slice(0, 500)}`);
  }
  return normalise(parsed);
}
