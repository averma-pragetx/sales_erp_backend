import * as pdfParseModule from 'pdf-parse';
import { GoogleGenAI } from '@google/genai';
import {
  IEquipmentBom, IBomComponent, INozzle, IProjectInfo,
} from '../models/Stage7Work';

const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
  (pdfParseModule as unknown as { default?: (buf: Buffer) => Promise<{ text: string }> }).default
  ?? (pdfParseModule as unknown as (buf: Buffer) => Promise<{ text: string }>);

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── System prompt (from step6_BOM.md) ───────────────────────────────────────

const SYSTEM_PROMPT = `You are a mechanical estimator specialising in shell & tube heat exchangers.

A Purchase Requisition (PR) PDF is provided. Extract a complete Bill of Materials (BOM) from ALL datasheets in the document (each tag number has multiple sheets — Sht.1, Sht.2, Sht.3). Read every mechanical details table, nozzle schedule, and notes section carefully.

Return ONLY valid JSON. No explanation, no markdown fences.

OUTPUT SCHEMA:
{
  "project": {
    "name": string,
    "job_no": string,
    "client": string,
    "consultant": string,
    "pr_number": string,
    "revision": string,
    "date": string
  },
  "equipment": [
    {
      "tag_no": string,
      "service": string,
      "tema_class": string,
      "exchanger_type": string,
      "size_id_mm": number,
      "size_sl_mm": number,
      "no_of_shells": number,
      "no_of_passes_shell": number,
      "no_of_passes_tube": number,
      "design_pressure_shell": string,
      "design_pressure_tube": string,
      "design_temp_shell_C": number,
      "design_temp_tube_C": number,
      "fluid_shell": string,
      "fluid_tube": string,
      "corrosion_allowance_shell_mm": number,
      "corrosion_allowance_tube_mm": number,
      "stress_relieving": string,
      "radiography": string,
      "bundle_weight_kg": number | null,
      "empty_weight_kg": number | null,
      "full_water_weight_kg": number | null,
      "deleted_from_scope": boolean,
      "ibr_applicable": boolean,
      "hydrogen_service": boolean,
      "bom": [
        {
          "sr_no": string,
          "component": string,
          "applicable": "Yes" | "No",
          "moc": string | null,
          "moc_source": "datasheet" | "inferred" | "not_found",
          "moc_flag": string | null,
          "type_detail": string | null,
          "remarks": string,
          "weight_kg": number | null,
          "quantity": string,
          "unit": string
        }
      ],
      "nozzle_schedule": [
        {
          "mark": string,
          "size_nps": string,
          "asme_class": string,
          "schedule": string,
          "facing": string,
          "designation": string,
          "moc_neck": string | null,
          "moc_flange": string | null,
          "moc_flag": string | null
        }
      ]
    }
  ]
}

EXTRACTION RULES:
1. MOC — Read the full mechanical details table. For each component: if clearly stated set moc_source="datasheet"; if ambiguous set moc_source="inferred" with moc_flag warning; if blank set moc=null, moc_source="not_found", moc_flag="NOT STATED IN DOCUMENT — obtain from MSD before procurement". NEVER leave moc_flag null when moc is null or inferred.
2. Weights — Extract from Wt(Kg) column. If blank, use null — do NOT estimate.
3. Nozzles — Extract every row from the nozzle schedule on Sht.1.
4. Multiple tags — Process each tag as a separate equipment object.
5. Scope flags — deleted_from_scope=true if tag explicitly deleted; ibr_applicable=true if IBR noted; hydrogen_service=true if H2 service noted.
6. Accuracy — Do NOT invent values. If a field is not found, use null and note in remarks.`;

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
    weightKg:   numOrNull(raw.weight_kg),
    quantity:   str(raw.quantity),
    unit:       str(raw.unit),
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
    bom:            Array.isArray(raw.bom) ? (raw.bom as Record<string, unknown>[]).map(normComp) : [],
    nozzleSchedule: Array.isArray(raw.nozzle_schedule) ? (raw.nozzle_schedule as Record<string, unknown>[]).map(normNozzle) : [],
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
    temperature:       0,
  };

  let rawJson = '';
  if (docText.length > 200) {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      config: cfg,
      contents: [{ role: 'user', parts: [{ text: `${userPrompt}\n\nDOCUMENT TEXT:\n${docText}` }] }],
    });
    rawJson = result.text ?? '';
  } else {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
