import OpenAI from 'openai';
import { Inquiry } from '../models/Inquiry';
import { Section } from '../models/Section';
import { Stage3Work } from '../models/Stage3Work';
import { Stage4Work } from '../models/Stage4Work';
import { TechQuery } from '../models/TechQuery';
import { Stage7Work } from '../models/Stage7Work';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY in env.');
  return new OpenAI({ apiKey });
}

export interface ProposalResult {
  title: string;
  body: string;
}

function inr(n: number): string {
  return '₹' + n.toLocaleString('en-IN');
}

function sectionBlock(label: string, content: string): string {
  return content.trim()
    ? `\n${'='.repeat(75)}\n${label}\n${'='.repeat(75)}\n${content.trim()}`
    : '';
}

export async function draftProposal(inquiryId: string): Promise<ProposalResult> {

  const [inquiry, sections, stage3, stage4, tqs, bom] = await Promise.all([
    Inquiry.findOne({ inquiryId }).lean(),
    Section.find({ inquiryId }).sort({ documentId: 1, sectionIndex: 1 }).lean(),
    Stage3Work.findOne({ inquiryId }).lean(),
    Stage4Work.findOne({ inquiryId }).lean(),
    TechQuery.find({ inquiryId, status: 'answered' }).sort({ tqIndex: 1 }).lean(),
    Stage7Work.findOne({ inquiryId }).lean(),
  ]);

  if (!inquiry) throw new Error(`Inquiry ${inquiryId} not found.`);

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

  const sectionsBlock = sections.length > 0
    ? sections.map(s =>
      `Document: ${s.documentTitle} (${s.docType}) | Section: "${s.title}"\n` +
      `Summary: ${s.summary}\n` +
      (s.content.length <= 1200 ? `Content:\n${s.content}` : `Content (excerpt):\n${s.content.slice(0, 1200)}…`)
    ).join('\n\n---\n\n')
    : '(No RFQ sections extracted yet — base proposal on enquiry scope and tag list.)';

  const tagsBlock = (stage4?.status === 'done' && stage4.tags.length > 0)
    ? stage4.tags.map((t, i) =>
      `${String(i + 1).padStart(2, '0')}. TAG: ${t.tagNumber} | Product: ${t.productName} | ` +
      `Qty: ${t.quantity} | Dimensions: ${t.dimensions} | Wt/unit: ${t.weightPerUnit}` +
      (t.notes ? ` | Notes: ${t.notes}` : '')
    ).join('\n')
    : '(Tag list not yet extracted — include a placeholder equipment schedule.)';

  const gapBlock = (stage3?.gapAnalysis?.status === 'done')
    ? [
      `Required sections : ${stage3.gapAnalysis.requiredSections.join(', ') || 'N/A'}`,
      `Received sections : ${stage3.gapAnalysis.receivedSections.join(', ') || 'N/A'}`,
      `Critical gaps     :`,
      ...(stage3.gapAnalysis.gaps.map(g => `  • [${g.severity.toUpperCase()}] ${g.section} — ${g.reason}`)),
      `Recommendation    : ${stage3.gapAnalysis.recommendation}`,
    ].join('\n')
    : '(Gap analysis not yet run.)';

  const tqBlock = tqs.length > 0
    ? tqs.map(tq =>
      `${tq.tqNumber}  |  TAG/Clause: ${tq.tagClause} / ${tq.clauseRef}  |  To: ${tq.sendTo}\n` +
      `Q: ${tq.question}\n` +
      `A: ${tq.answer}`
    ).join('\n\n')
    : '(No answered technical queries — state "No technical deviations or clarifications at this stage.")';

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

  const systemPrompt =
    `You are a senior proposals engineer at Oswal Engineering (OEL), a leading Indian industrial ` +
    `equipment manufacturer. You are drafting a formal Techno-Commercial Proposal. ` +
    `Respond ONLY with valid JSON: { "title": "string", "body": "string" }. ` +
    `"title" is a single-line offer title. "body" is the full proposal in GitHub-flavored Markdown. ` +
    `Minimum 1,500 words. Never say "we" — always use "Oswal Engineering" or "OEL". ` +
    `All monetary values in INR with Indian comma formatting. ` +
    `Never invent technical specs — use "[As per client specification]" where unknown.`;

  const userPrompt = `\
${sectionBlock('ENQUIRY DATA', headerBlock)}
${sectionBlock('SCOPE OF WORK — EXTRACTED FROM RFQ DOCUMENTS', sectionsBlock)}
${sectionBlock('EQUIPMENT / TAG LIST', tagsBlock)}
${sectionBlock('DOCUMENT GAP ANALYSIS', gapBlock)}
${sectionBlock('ANSWERED TECHNICAL QUERIES & CLARIFICATIONS', tqBlock)}
${sectionBlock('BILL OF MATERIALS — COST ESTIMATE', bomBlock)}

${'='.repeat(75)}
PROPOSAL INSTRUCTIONS
${'='.repeat(75)}

Draft a complete Techno-Commercial Proposal in GitHub-flavored Markdown with these sections in order:
[Title Line], Reference Details (table), 1. Introduction, 2. Understanding of Scope & Scope of Supply,
3. Technical Basis & Design Parameters, 4. Equipment Schedule (table), 5. Technical Deviations & Clarifications,
6. Commercial Offer (6.1 BOM table + 6.2 Price Basis), 7. Delivery Schedule, 8. Terms & Conditions
(Payment Terms / Offer Validity / Warranty / Packing / Freight / Inspection / Force Majeure),
9. Exclusions, 10. Closing.

Use the enquiry data and BOM values above. Where tag list says "not specified", write "To be confirmed as per client datasheet".
Sign off contact as "[Contact Name] | Proposals Department | Oswal Engineering Pvt. Ltd."`;

  const ai = getClient();

  const res = await ai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    max_tokens: 8192,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const result = JSON.parse(res.choices[0].message.content ?? '{}') as ProposalResult;

  if (!result.title || !result.body) {
    throw new Error('OpenAI returned an incomplete proposal — missing title or body.');
  }

  return result;
}
