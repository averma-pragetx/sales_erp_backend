import type { IGap } from '../models/Stage3Work';
import { getOpenAI as getClient } from '../ai/clients';

export interface SectionInput {
  docType: string;
  documentTitle: string;
  title: string;
  summary: string;
}

export interface GapAnalysisResult {
  requiredSections: string[];
  receivedSections: string[];
  gaps: IGap[];
  recommendation: string;
}

export interface EmailDraftResult {
  subject: string;
  body: string;
}

// ─── 1. Gap analysis ─────────────────────────────────────────────────────────

export async function analyseGaps(
  inquiryId: string,
  scope: string,
  client: string,
  sections: SectionInput[],
): Promise<GapAnalysisResult> {
  const ai = getClient();

  const sectionList = sections.length > 0
    ? sections.map(s => `[${s.docType} — ${s.documentTitle}]\n  Section: ${s.title}\n  Summary: ${s.summary}`).join('\n\n')
    : '(No sections extracted yet — documents may not have been processed.)';

  const systemPrompt =
    `You are a senior estimator reviewing an RFQ package. ` +
    `Respond ONLY with valid JSON matching this exact structure:\n` +
    `{\n` +
    `  "requiredSections": ["string"],\n` +
    `  "receivedSections": ["string"],\n` +
    `  "gaps": [{ "section": "string", "reason": "string", "severity": "critical|major|minor" }],\n` +
    `  "recommendation": "string"\n` +
    `}\n` +
    `Limit gaps to the 2-3 most critical only. Be concise.`;

  const userPrompt =
    `Inquiry: ${inquiryId} | Scope: ${scope} | Client: ${client}\n\n` +
    `Extracted document sections:\n\n${sectionList}\n\n` +
    `Identify required sections, received sections, critical gaps, and give a 1-2 sentence recommendation.`;

  const res = await ai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const result = JSON.parse(res.choices[0].message.content ?? '{}') as GapAnalysisResult;
  result.gaps = (result.gaps ?? []).slice(0, 3);
  return result;
}

// ─── 2. Acknowledgment email draft ───────────────────────────────────────────

export async function draftEmail(
  inquiryId: string,
  scope: string,
  client: string,
  project: string,
  gapAnalysis: GapAnalysisResult,
): Promise<EmailDraftResult> {
  const ai = getClient();

  const received = gapAnalysis.receivedSections.join(', ') || 'none identified';
  const missing = gapAnalysis.gaps.length > 0
    ? gapAnalysis.gaps.map(g => `• ${g.section} — ${g.reason}`).join('\n')
    : 'All critical sections appear to be present.';

  const systemPrompt =
    `You are drafting a professional B2B email on behalf of Oswal Engineering. ` +
    `Respond ONLY with valid JSON: { "subject": "string", "body": "string" }. ` +
    `The body must be plain text (no markdown), max 250 words, signed off as "Estimation Team, Oswal Engineering."`;

  const userPrompt =
    `Draft an RFQ acknowledgment email.\n\n` +
    `Inquiry: ${inquiryId} | Client: ${client} | Project: ${project} | Scope: ${scope}\n\n` +
    `Received sections: ${received}\n\n` +
    `Missing/incomplete sections:\n${missing}\n\n` +
    `Overall recommendation: ${gapAnalysis.recommendation}\n\n` +
    `The email should: acknowledge receipt, confirm what was received, politely request missing sections ` +
    `with a suggested response deadline, and state estimation commences once the complete package is received.`;

  const res = await ai.chat.completions.create({
    model: 'gpt-5.4',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return JSON.parse(res.choices[0].message.content ?? '{}') as EmailDraftResult;
}
