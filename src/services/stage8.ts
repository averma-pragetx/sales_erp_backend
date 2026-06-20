import { GoogleGenAI, Type } from '@google/genai';
import { Inquiry }    from '../models/Inquiry';
import { Section }    from '../models/Section';
import { Stage3Work } from '../models/Stage3Work';
import { Stage4Work } from '../models/Stage4Work';
import { TechQuery }  from '../models/TechQuery';
import { Stage7Work } from '../models/Stage7Work';

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalResult {
  title: string;
  body:  string;
}

// ─── Gemini schema ────────────────────────────────────────────────────────────

const PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: {
      type: Type.STRING,
      description: 'Single-line offer title for the proposal document.',
    },
    body: {
      type: Type.STRING,
      description: 'Full proposal text in GitHub-flavored Markdown. All sections must be present.',
    },
  },
  required: ['title', 'body'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function sectionBlock(label: string, content: string): string {
  return content.trim()
    ? `\n${'='.repeat(75)}\n${label}\n${'='.repeat(75)}\n${content.trim()}`
    : '';
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function draftProposal(inquiryId: string): Promise<ProposalResult> {

  // ── 1. Gather all available data in parallel ─────────────────────────────

  const [inquiry, sections, stage3, stage4, tqs, bom] = await Promise.all([
    Inquiry.findOne({ inquiryId }).lean(),
    Section.find({ inquiryId }).sort({ documentId: 1, sectionIndex: 1 }).lean(),
    Stage3Work.findOne({ inquiryId }).lean(),
    Stage4Work.findOne({ inquiryId }).lean(),
    TechQuery.find({ inquiryId, status: 'answered' }).sort({ tqIndex: 1 }).lean(),
    Stage7Work.findOne({ inquiryId }).lean(),
  ]);

  if (!inquiry) throw new Error(`Inquiry ${inquiryId} not found.`);

  // ── 2. Build data blocks for the prompt ──────────────────────────────────

  // — Inquiry header —
  const headerBlock = [
    `Inquiry Reference  : ${inquiryId}`,
    `Client             : ${inquiry.client}`,
    `Project            : ${inquiry.project}`,
    `Scope / Package    : ${inquiry.scope}`,
    `Enquiry Received   : ${inquiry.receivedDate}`,
    `Bid Due Date       : ${inquiry.bidDue}`,
    `Priority           : ${inquiry.priority}`,
    `Estimator          : ${inquiry.estimator}`,
    `Indicative Budget  : ${inquiry.value} ${inquiry.valueUnit} ${inquiry.currency}`,
    `Enquiry Source     : ${inquiry.source}`,
  ].join('\n');

  // — RFQ sections (summaries preferred to keep prompt focused) —
  const sectionsBlock = sections.length > 0
    ? sections.map(s =>
        `Document: ${s.documentTitle} (${s.docType}) | Section: "${s.title}"\n` +
        `Summary: ${s.summary}\n` +
        (s.content.length <= 1200 ? `Content:\n${s.content}` : `Content (excerpt):\n${s.content.slice(0, 1200)}…`)
      ).join('\n\n---\n\n')
    : '(No RFQ sections extracted yet — base proposal on enquiry scope and tag list.)';

  // — Equipment / Tag list —
  const tagsBlock = (stage4?.status === 'done' && stage4.tags.length > 0)
    ? stage4.tags.map((t, i) =>
        `${String(i + 1).padStart(2, '0')}. TAG: ${t.tagNumber} | Product: ${t.productName} | ` +
        `Qty: ${t.quantity} | Dimensions: ${t.dimensions} | Wt/unit: ${t.weightPerUnit}` +
        (t.notes ? ` | Notes: ${t.notes}` : '')
      ).join('\n')
    : '(Tag list not yet extracted — include a placeholder equipment schedule.)';

  // — Gap analysis —
  const gapBlock = (stage3?.gapAnalysis?.status === 'done')
    ? [
        `Required sections : ${stage3.gapAnalysis.requiredSections.join(', ') || 'N/A'}`,
        `Received sections : ${stage3.gapAnalysis.receivedSections.join(', ') || 'N/A'}`,
        `Critical gaps     :`,
        ...(stage3.gapAnalysis.gaps.map(g => `  • [${g.severity.toUpperCase()}] ${g.section} — ${g.reason}`)),
        `Recommendation    : ${stage3.gapAnalysis.recommendation}`,
      ].join('\n')
    : '(Gap analysis not yet run.)';

  // — Answered Technical Queries —
  const tqBlock = tqs.length > 0
    ? tqs.map(tq =>
        `${tq.tqNumber}  |  TAG/Clause: ${tq.tagClause} / ${tq.clauseRef}  |  To: ${tq.sendTo}\n` +
        `Q: ${tq.question}\n` +
        `A: ${tq.answer}`
      ).join('\n\n')
    : '(No answered technical queries — state "No technical deviations or clarifications at this stage.")';

  // — BOM / Cost estimate —
  const bomBlock = (bom?.status === 'done' && bom.items.length > 0)
    ? [
        bom.items.map((item, i) =>
          `${String(i + 1).padStart(2, '0')}. TAG: ${item.tagNumber || '—'} | ` +
          `${item.productName} | Qty: ${item.quantity} ${item.quantityUnit} | ` +
          `Unit Rate: ${inr(item.rateInr)} | Total: ${inr(item.totalInr)}`
        ).join('\n'),
        `\nGrand Total (ex-GST): ${inr(bom.grandTotalInr)}`,
      ].join('\n')
    : '(BOM not yet estimated — include a placeholder pricing table with TBD values.)';

  // ── 3. Assemble the master prompt ─────────────────────────────────────────

  const prompt = `\
You are a senior proposals engineer at Oswal Engineering (OEL), a leading Indian industrial \
equipment manufacturer and EPC contractor with expertise in oil & gas, chemicals, water treatment, \
and process industries. You are drafting a formal Techno-Commercial Proposal that will be \
reviewed internally and then submitted to the client.
${sectionBlock('ENQUIRY DATA', headerBlock)}
${sectionBlock('SCOPE OF WORK — EXTRACTED FROM RFQ DOCUMENTS', sectionsBlock)}
${sectionBlock('EQUIPMENT / TAG LIST', tagsBlock)}
${sectionBlock('DOCUMENT GAP ANALYSIS', gapBlock)}
${sectionBlock('ANSWERED TECHNICAL QUERIES & CLARIFICATIONS', tqBlock)}
${sectionBlock('BILL OF MATERIALS — COST ESTIMATE', bomBlock)}

${'='.repeat(75)}
PROPOSAL INSTRUCTIONS
${'='.repeat(75)}

Draft a complete, well-structured Techno-Commercial Proposal in GitHub-flavored Markdown.
This document will be reviewed by Oswal Engineering's proposals team before submission to the client.
Follow the exact section structure below. Do NOT skip or reorder sections.

---

## [Title Line]
*Single-line offer title, e.g.: "Techno-Commercial Offer for Supply of [scope] | Our Ref: ${inquiryId} | [Client] – [Project]"*

---

## Reference Details

| | |
|:--|:--|
| **Our Reference** | ${inquiryId} |
| **Your Enquiry** | [client reference if mentioned, else "—"] |
| **Client** | ${inquiry.client} |
| **Project** | ${inquiry.project} |
| **Enquiry Date** | ${inquiry.receivedDate} |
| **Offer Date** | [today's date] |
| **Offer Validity** | 30 days from date of offer |

---

## 1. Introduction
*Two to three paragraphs:*
*(a) Acknowledge receipt of the enquiry with full reference number and thank the client.*
*(b) Provide a brief Oswal Engineering company overview — established company, capabilities, industry sectors, quality certifications (ISO 9001, IBR, ASME stamp as applicable).*
*(c) State that OEL has carefully studied the enquiry documents and is pleased to submit this offer.*

---

## 2. Understanding of Scope & Scope of Supply
*Opening paragraph confirming OEL's understanding of the overall project and the specific scope of this enquiry.*
*Followed by a bulleted list of major equipment, systems, and deliverables to be supplied under this offer.*
*Cross-reference the RFQ document sections where relevant.*

---

## 3. Technical Basis & Design Parameters
*Table or bullet list of:*
*- Applicable codes and standards (ASME Section VIII, IS 2825, IBR, ATEX Directive, etc. — only those relevant to the equipment listed)*
*- Key design parameters (design pressure, temperature, material, corrosion allowance — infer from tag list and RFQ; where not confirmed use "[As per client specification]")*
*- Quality and inspection requirements*

---

## 4. Equipment Schedule

| TAG No. | Equipment Description | Specification / Design Basis | Qty | Unit | Remarks |
|:--|:--|:--|--:|:--|:--|
*(One row per tag list item. If tag list data is missing, use TBD. Add a "To be confirmed" row at the end for any items pending client clarification.)*

---

## 5. Technical Deviations & Clarifications
*(If answered TQs exist: list each one as a numbered clarification.)*
*(If no TQs: write "No technical deviations are taken from the enquiry specification at this stage. All equipment shall be designed and supplied strictly as per the enquiry documents.")*

---

## 6. Commercial Offer

### 6.1 Bill of Materials

| Sr. | TAG | Item Description | Qty | Unit | Unit Rate (INR) | Total Amount (INR) |
|--:|:--|:--|--:|:--|--:|--:|
*(One row per BOM item. Use actual values from the BOM data above. If BOM is pending, insert TBD values.)*
| | | | | **Grand Total (Ex-GST)** | | **[grand total]** |

*All prices are in Indian Rupees (INR). Goods and Services Tax (GST) shall be charged extra at applicable rates.*

### 6.2 Price Basis
*State: Ex-works [city], F.O.R. destination (as applicable), inclusive/exclusive of Packing & Forwarding.*

---

## 7. Delivery Schedule
*(Estimate realistic lead time in weeks from receipt of: (a) confirmed Purchase Order, (b) approved drawings, and (c) advance payment — based on the complexity of equipment in the tag list. Typical range: 12–24 weeks for fabricated pressure equipment; 6–10 weeks for standard packages. State milestones: design approval, material procurement, fabrication, FAT, dispatch.)*

---

## 8. Terms & Conditions

### 8.1 Payment Terms
- 30% advance against Purchase Order
- 60% against Factory Acceptance Test (FAT) or prior to dispatch (whichever is applicable)
- 10% against satisfactory site acceptance / commissioning
*(Adjust if the scope indicates a simpler supply-only arrangement.)*

### 8.2 Offer Validity
This offer is valid for **30 days** from the date of submission.

### 8.3 Warranty
Equipment is warranted against defects in materials and workmanship for **12 months from the date of commissioning** or **18 months from the date of dispatch**, whichever occurs earlier.

### 8.4 Packing & Forwarding
Standard export-worthy packing is included in the quoted price unless otherwise noted.

### 8.5 Freight & Insurance
*(State basis: ex-works / FOR destination / CIF as applicable. Buyer's insurance unless otherwise agreed.)*

### 8.6 Inspection & Testing
Factory Acceptance Testing (FAT) as per agreed ITP. Third-party inspection by a mutually approved TPI agency, if required, shall be at client's cost.

### 8.7 Force Majeure & Governing Law
Standard force majeure clause applies. Any disputes shall be subject to arbitration under the Arbitration and Conciliation Act, 1996, at [city], India. Governing law: laws of India.

---

## 9. Exclusions
*(Comprehensive bullet list of what is NOT included in this offer. Standard exclusions for Indian EPC: civil & structural work, erection & commissioning, site supervision, customs duty on imported items unless stated, operating consumables, utility connections, etc.)*

---

## 10. Closing

*(One professional closing paragraph: invite the client to contact OEL for any clarifications, express OEL's keenness to be associated with the project, and state the contact person / designation as "[Contact Name] | Proposals Department | Oswal Engineering Pvt. Ltd." as a placeholder.)*

---

WRITING RULES (MANDATORY):
1. Always refer to the company as "Oswal Engineering" or "OEL" — never "we" or "our company" in formal sections.
2. All monetary values in INR with Indian comma formatting (e.g., ₹12,50,000).
3. Never invent technical specifications not present in the input data. For unconfirmed specs write "[As per client specification]" or "[To be confirmed]".
4. Where the tag list says "not specified", write "To be confirmed as per client datasheet" in the equipment schedule.
5. Keep language precise and formal — avoid qualifiers like "approximately", "roughly", "we think".
6. The proposal must read as a complete, standalone document — no external references to "the prompt" or "input data".
7. Minimum 1,500 words for the body. A thorough proposal is expected.`;

  // ── 4. Call Gemini ────────────────────────────────────────────────────────

  const ai = getClient();

  const response = await ai.models.generateContent({
    model:    'gemini-2.5-flash',
    contents: [{ text: prompt }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   PROPOSAL_SCHEMA,
    },
  });

  const result = JSON.parse(response.text ?? '{}') as ProposalResult;

  if (!result.title || !result.body) {
    throw new Error('Gemini returned an incomplete proposal — missing title or body.');
  }

  return result;
}
