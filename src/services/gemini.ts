import { GoogleGenAI, Type } from '@google/genai';

// ─── Response shape (mirrors the JSON schema below) ──────────────────────────

export interface ExtractionSection {
  title:   string;
  content: string;
  summary: string;
}

export interface ExtractionResult {
  overview:  string;
  keyItems:  string[];
  sections:  ExtractionSection[];
}

// ─── Structured JSON schema sent to Gemini ────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    overview: {
      type: Type.STRING,
      description:
        'Two sentences max. What is being procured, by whom, and the single most critical constraint. Under 50 words total.',
    },
    keyItems: {
      type: Type.ARRAY,
      description:
        'Exactly 6 bullet strings (no more). Each under 15 words. Cover: scope, TAG numbers, quantity, delivery date, payment terms, bid deadline.',
      items: { type: Type.STRING },
    },
    sections: {
      type: Type.ARRAY,
      description:
        'The 8 most commercially significant sections only (no more than 8). Skip boilerplate like definitions or general conditions.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'Section heading. Under 10 words.',
          },
          content: {
            type: Type.STRING,
            description: 'One sentence. State the single most important requirement. Under 25 words.',
          },
          summary: {
            type: Type.STRING,
            description: 'One sentence action item for the sales team. Under 20 words.',
          },
        },
        required: ['title', 'content', 'summary'],
      },
    },
  },
  required: ['overview', 'keyItems', 'sections'],
};

// ─── Client ───────────────────────────────────────────────────────────────────

// Singleton — one client per process, not one per request
let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in env.');
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractDocument(
  base64Data: string,
  mimeType:   string,
  docType:    string,
  scope:      string,
  inquiryId:  string,
): Promise<ExtractionResult> {
  const ai = getClient();

  const prompt =
    `Here is the full updated prompt that seamlessly combines your specific engineering persona, the strict extraction instructions, your dynamic variables (docType, inquiryId, and scope), and the complete JSON schema.

You are a senior procurement and engineering document analyst with deep expertise in EPC projects, heat exchangers, pressure vessels, and industrial equipment RFQ packages.

Analyze this ${docType} document for inquiry ${inquiryId} (scope: ${scope}). Read it entirely and extract EVERY piece of information available. Miss nothing. Be comprehensive, but follow the format strictly. Each extracted text value within the fields must be concise and summarized—never copy massive walls of raw text from the document verbatim.

Return a single valid JSON object. No markdown. No explanation. No preamble. Only JSON.

{
"document_meta": {
"document_number": "",
"document_title": "",
"revision": "",
"date": "",
"project_name": "",
"project_number": "",
"client": "",
"contractor_epc": "",
"unit_area": "",
"department": "",
"division": "",
"prepared_by": "",
"checked_by": "",
"approved_by": "",
"issued_for": "",
"supplier_code": "",
"supplier_name": "",
"total_pages": ""
},
"table_of_contents": [
{
"document_number": "",
"revision": "",
"title": "",
"page_number": ""
}
],
"scope_of_supply": {
"overall_description": "",
"items": [
{
"sl_no": "",
"tag_number": "",
"description": "",
"quantity": "",
"unit": "",
"delivery_location": ""
}
],
"services_included": [],
"exclusions": []
},
"technical_requirements": {
"equipment_type": "",
"applicable_codes_and_standards": [],
"design_conditions": [
{
"tag": "",
"shell_side": {
"fluid": "",
"operating_pressure": "",
"design_pressure": "",
"operating_temperature": "",
"design_temperature": "",
"flow_rate": "",
"material": ""
},
"tube_side": {
"fluid": "",
"operating_pressure": "",
"design_pressure": "",
"operating_temperature": "",
"design_temperature": "",
"flow_rate": "",
"material": ""
},
"heat_duty": "",
"tema_class": "",
"ibr_applicable": ""
}
],
"material_specifications": [],
"ndt_requirements": [],
"pwht_requirements": "",
"hydro_test_requirements": "",
"pmi_requirements": "",
"painting_and_coating": "",
"insulation_requirements": "",
"surface_preparation": "",
"pickling_passivation": "",
"tube_layout_guidelines": "",
"special_technical_notes": []
},
"datasheets": [
{
"document_number": "",
"tag_number": "",
"title": "",
"revision": "",
"all_fields": {}
}
],
"vendor_data_requirements": {
"document_number": "",
"revision": "",
"submission_schedule": "",
"required_documents": [
{
"document_type": "",
"description": "",
"copies": "",
"stage": ""
}
]
},
"inspection_and_testing": {
"itp_document_number": "",
"itp_revision": "",
"inspection_stages": [],
"third_party_inspection": "",
"client_witness_points": [],
"hold_points": [],
"review_points": []
},
"quality_requirements": {
"qms_spec_reference": "",
"quality_plan_required": "",
"sub_vendor_control": "",
"special_quality_clauses": []
},
"specifications_included": [
{
"spec_number": "",
"revision": "",
"title": "",
"key_requirements": []
}
],
"drawings_included": [
{
"drawing_number": "",
"revision": "",
"title": "",
"type": ""
}
],
"commercial_terms": {
"bid_due_date": "",
"delivery_period": "",
"delivery_terms": "",
"delivery_location": "",
"payment_terms": "",
"bid_validity_period": "",
"currency": "",
"price_basis": "",
"taxes_and_duties": "",
"liquidated_damages": "",
"performance_bank_guarantee": "",
"spare_parts_required": "",
"special_tools_required": "",
"packing_requirements": ""
},
"vendor_instructions": {
"quote_basis": "",
"conflict_resolution_order": [],
"sub_vendor_approval_required": "",
"fabrication_notes": [],
"all_numbered_clauses": [
{
"clause_number": "",
"clause_text": ""
}
]
},
"referenced_documents": [
{
"document_number": "",
"title": "",
"revision": ""
}
],
"missing_documents_or_gaps": [],
"critical_flags": []
}`;

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
      responseSchema:   RESPONSE_SCHEMA,
      maxOutputTokens:  2048,
    },
  });

  let raw = '';
  for await (const chunk of stream) {
    raw += chunk.text || '';
  }

  raw = raw.trim();
  if (!raw) throw new Error('Gemini returned an empty response. Check your API key and model access.');

  const result = JSON.parse(raw) as Partial<ExtractionResult>;

  return {
    overview: result.overview  ?? '',
    keyItems: result.keyItems  ?? [],
    sections: (result.sections ?? []).map(s => ({
      title:   s.title   ?? '',
      content: s.content ?? '',
      summary: s.summary ?? '',
    })),
  };
}
