import { GoogleGenAI, Type } from '@google/genai';
import type { IGap } from '../models/Stage3Work';

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_API_KEY in env.');
  return new GoogleGenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SectionInput {
  docType:       string;
  documentTitle: string;
  title:         string;
  summary:       string;
}

export interface GapAnalysisResult {
  requiredSections: string[];
  receivedSections: string[];
  gaps:             IGap[];
  recommendation:   string;
}

export interface EmailDraftResult {
  subject: string;
  body:    string;
}

// ─── 1. Gap analysis ─────────────────────────────────────────────────────────

const GAP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    requiredSections: {
      type: Type.ARRAY,
      description: 'Section titles typically expected in this type of RFQ package.',
      items: { type: Type.STRING },
    },
    receivedSections: {
      type: Type.ARRAY,
      description: 'Section titles actually found across the uploaded documents.',
      items: { type: Type.STRING },
    },
    gaps: {
      type: Type.ARRAY,
      description: 'The 2-3 most critical missing or incomplete sections only.',
      items: {
        type: Type.OBJECT,
        properties: {
          section:  { type: Type.STRING, description: 'Name of the missing or incomplete section.' },
          reason:   { type: Type.STRING, description: 'Why this section is needed and what impact its absence has.' },
          severity: { type: Type.STRING, description: 'critical | major | minor' },
        },
        required: ['section', 'reason', 'severity'],
      },
    },
    recommendation: {
      type: Type.STRING,
      description: '1-2 sentence overall recommendation to the estimator.',
    },
  },
  required: ['requiredSections', 'receivedSections', 'gaps', 'recommendation'],
};

export async function analyseGaps(
  inquiryId:  string,
  scope:      string,
  client:     string,
  sections:   SectionInput[],
): Promise<GapAnalysisResult> {
  const ai = getClient();

  const sectionList = sections.length > 0
    ? sections.map(s => `[${s.docType} — ${s.documentTitle}]\n  Section: ${s.title}\n  Summary: ${s.summary}`).join('\n\n')
    : '(No sections extracted yet — documents may not have been processed.)';

  const prompt =
    `You are a senior estimator reviewing the RFQ package for inquiry ${inquiryId} ` +
    `(scope: ${scope}, client: ${client}).\n\n` +
    `The following sections have been extracted from the uploaded documents:\n\n` +
    `${sectionList}\n\n` +
    `Based on standard procurement practice for this type of equipment package, ` +
    `identify what sections are typically required, which have been received, ` +
    `and flag the 2-3 most critical gaps or missing sections only. ` +
    `Be concise and specific — the estimator needs to know exactly what to request from the client.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ text: prompt }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   GAP_SCHEMA,
    },
  });

  const result = JSON.parse(response.text ?? '{}') as GapAnalysisResult;

  // Clamp gaps to max 3
  result.gaps = result.gaps.slice(0, 3);

  return result;
}

// ─── 2. Acknowledgment email draft ───────────────────────────────────────────

const EMAIL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    subject: {
      type: Type.STRING,
      description: 'Concise email subject line referencing the inquiry ID and project.',
    },
    body: {
      type: Type.STRING,
      description:
        'Full professional email body in plain text. ' +
        'Include: acknowledgment of receipt, list of documents received, ' +
        'list of missing/incomplete sections with a polite request to provide them, ' +
        'and expected next steps. Sign off as "Estimation Team, Oswal Engineering."',
    },
  },
  required: ['subject', 'body'],
};

export async function draftEmail(
  inquiryId:   string,
  scope:       string,
  client:      string,
  project:     string,
  gapAnalysis: GapAnalysisResult,
): Promise<EmailDraftResult> {
  const ai = getClient();

  const received = gapAnalysis.receivedSections.join(', ') || 'none identified';
  const missing  = gapAnalysis.gaps.length > 0
    ? gapAnalysis.gaps.map(g => `• ${g.section} — ${g.reason}`).join('\n')
    : 'All critical sections appear to be present.';

  const prompt =
    `Draft a professional acknowledgment email for inquiry ${inquiryId} — ` +
    `${client} · ${project} (scope: ${scope}).\n\n` +
    `Documents received cover these sections: ${received}.\n\n` +
    `Missing or incomplete sections:\n${missing}\n\n` +
    `Overall recommendation: ${gapAnalysis.recommendation}\n\n` +
    `The email should:\n` +
    `1. Acknowledge receipt of the RFQ package with the inquiry reference\n` +
    `2. Confirm what has been received\n` +
    `3. Politely but clearly request the missing sections with a suggested response deadline\n` +
    `4. State that estimation will commence once the complete package is received\n` +
    `5. Be professional, concise, and no more than 250 words in the body`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ text: prompt }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   EMAIL_SCHEMA,
    },
  });

  return JSON.parse(response.text ?? '{}') as EmailDraftResult;
}
