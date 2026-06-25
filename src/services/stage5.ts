import { GoogleGenAI } from '@google/genai';
import { IComplianceMeta, IComplianceItem } from '../models/Stage5Work';

// ─── Gemini client ────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior techno-commercial compliance engineer at an EPC vendor company (Oswal Engineering).

You will be given RFQ documents (ITB, BDS, SPC, GPC, ATC, RFQ).

Your job is to read every clause, condition, and requirement stated by the buyer and compare it against Oswal Engineering's standard terms and capabilities.

Return ONLY valid JSON. No markdown. No explanation. No preamble.

Oswal Engineering standard positions (use these as the offer/stand):
- Delivery basis: Ex-Works Kalol + 4 weeks transit
- Payment terms: 20% Advance · 10% major material order · 10% major material receipt · 60% IRN dispatch
- Bid validity: 30 days from quotation date
- Price basis: Firm price, INR
- Warranty: 12 months from commissioning or 18 months from dispatch whichever is earlier
- Inspection: Third party inspection by client-approved TPI agency at vendor's cost
- Zero-deviation: Not accepted as standard — deviations carried in Annexure-D
- Liquidated damages: Maximum 5% of order value
- Performance bank guarantee: 10% of order value, valid till end of warranty
- Governing law: Indian law, jurisdiction Ahmedabad

{
  "compliance_meta": {
    "tcl_document_ref": "",
    "tcl_revision": "",
    "total_compliance_items": 0,
    "compliant_count": 0,
    "deviation_count": 0,
    "open_under_review_count": 0,
    "blocker_count": 0,
    "categories": []
  },
  "compliance_matrix": [
    {
      "clause_id": "",
      "source_ref": "",
      "topic": "",
      "category": "",
      "rfq_buyer_requirement": "",
      "oswal_stand_offer": "",
      "impact": "",
      "status": "",
      "owner": "",
      "compliant_flag": false,
      "deviation_flag": false,
      "blocker_flag": false,
      "open_flag": false
    }
  ]
}

Classification rules:

STATUS:
- "Compliant" → Oswal's position fully matches RFQ requirement. No action needed.
- "Deviation" → Oswal's position differs from RFQ but is commercially manageable. Must be covered in Annexure-D.
- "Blocker" → RFQ clause that cannot be accepted as-is and requires VP-Sales decision before bid submission.
- "Under review" → Clause impact is unclear, ambiguous, or awaiting EIL / client clarification.

OWNER:
- Delivery, logistics, FOT/Ex-Works → "Logistics"
- Payment, LD, PBG, ABG, taxes → "Commercial"
- Weight, cost, margin, pricing → "Estimation"
- Zero-deviation, bid rejection risk → "VP-Sales"
- Design code, material, technical spec → "Engineering"

CATEGORY:
- "Commercial" → payment, delivery, LD, validity, taxes, PBG, ABG, warranties, zero-deviation
- "Technical" → design code, material spec, PWHT, NDE, TEMA class, IBR, weight, inspection

EXTRACTION RULES:
- Read every clause and condition — extract every requirement that has a commercial or technical obligation on the vendor
- Assign sequential clause IDs starting from #C01
- rfq_buyer_requirement must reflect what the buyer actually wrote — verbatim or close paraphrase
- oswal_stand_offer must reflect Oswal's standard positions listed above
- If a clause is fully compliant with Oswal standard, still include it — mark as "Compliant"
- Flag any zero-deviation, LD, PBG, governing law, and force majeure clause as mandatory extraction
- total_compliance_items must equal length of compliance_matrix array
- compliant_count + deviation_count + open_under_review_count + blocker_count must equal total_compliance_items`;

// ─── Normalise helpers ────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function normItem(raw: Record<string, unknown>): IComplianceItem {
  const status = str(raw.status) || 'Under review';
  return {
    clauseId:            str(raw.clause_id),
    sourceRef:           str(raw.source_ref),
    topic:               str(raw.topic),
    category:            str(raw.category),
    rfqBuyerRequirement: str(raw.rfq_buyer_requirement),
    oswalStandOffer:     str(raw.oswal_stand_offer),
    impact:              str(raw.impact),
    status,
    owner:               str(raw.owner),
    compliantFlag:       bool(raw.compliant_flag) || status === 'Compliant',
    deviationFlag:       bool(raw.deviation_flag) || status === 'Deviation',
    blockerFlag:         bool(raw.blocker_flag)   || status === 'Blocker',
    openFlag:            bool(raw.open_flag)      || status === 'Under review',
    statusOverride:      null,
    ownerOverride:       null,
    remarks:             '',
  };
}

export interface ComplianceAnalysisResult {
  complianceMeta:   IComplianceMeta;
  complianceMatrix: IComplianceItem[];
}

function normalise(parsed: Record<string, unknown>): ComplianceAnalysisResult {
  const m = (parsed.compliance_meta as Record<string, unknown>) ?? {};
  const items = Array.isArray(parsed.compliance_matrix)
    ? (parsed.compliance_matrix as Record<string, unknown>[]).map(normItem)
    : [];

  const compliantCount  = items.filter(i => (i.statusOverride ?? i.status) === 'Compliant').length;
  const deviationCount  = items.filter(i => (i.statusOverride ?? i.status) === 'Deviation').length;
  const blockerCount    = items.filter(i => (i.statusOverride ?? i.status) === 'Blocker').length;
  const openCount       = items.filter(i => (i.statusOverride ?? i.status) === 'Under review').length;

  const complianceMeta: IComplianceMeta = {
    tclDocumentRef:       str(m.tcl_document_ref),
    tclRevision:          str(m.tcl_revision),
    totalComplianceItems: num(m.total_compliance_items) || items.length,
    compliantCount:       num(m.compliant_count)  || compliantCount,
    deviationCount:       num(m.deviation_count)  || deviationCount,
    openUnderReviewCount: num(m.open_under_review_count) || openCount,
    blockerCount:         num(m.blocker_count)    || blockerCount,
    categories:           Array.isArray(m.categories) ? (m.categories as string[]).map(str) : [],
  };

  return { complianceMeta, complianceMatrix: items };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface DocumentSection {
  docType: string;
  documentTitle: string;
  title: string;
  content: string;
}

export async function analyseCompliance(
  inquiryId: string,
  scope: string,
  sections: DocumentSection[],
): Promise<ComplianceAnalysisResult> {
  if (!sections.length) {
    throw new Error(
      'No document sections found. Run Stage 2 document review first to extract RFQ content.',
    );
  }

  // Group sections by document
  const byDoc = new Map<string, { docType: string; sections: DocumentSection[] }>();
  for (const s of sections) {
    const key = s.documentTitle;
    if (!byDoc.has(key)) byDoc.set(key, { docType: s.docType, sections: [] });
    byDoc.get(key)!.sections.push(s);
  }

  const docBlocks = [...byDoc.entries()].map(([title, v]) => {
    const sectionText = v.sections
      .map(s => (s.title ? `[${s.title}]\n${s.content}` : s.content))
      .join('\n\n');
    return `=== DOCUMENT: ${title} (${v.docType || 'RFQ'}) ===\n${sectionText}`;
  });

  const userPrompt = [
    `INQUIRY: ${inquiryId}`,
    `SCOPE: ${scope}`,
    '',
    'DOCUMENT CONTENT:',
    docBlocks.join('\n\n'),
    '',
    'Analyse the above RFQ document content and return the compliance matrix JSON.',
  ].join('\n');

  const ai = getClient();

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType:  'application/json',
      maxOutputTokens:   32768,
      temperature:       0,
    },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  });

  const rawJson = result.text ?? '';
  const clean   = rawJson
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `Gemini returned invalid JSON for Stage 5: ${String(e)}\nRaw (first 500): ${clean.slice(0, 500)}`,
    );
  }

  return normalise(parsed);
}
