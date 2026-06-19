import mongoose, { Schema, Document } from 'mongoose';

export type WorkStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface IGap {
  section:  string;
  reason:   string;
  severity: 'critical' | 'major' | 'minor';
}

export interface IGapAnalysis {
  status:           WorkStatus;
  error:            string;
  requiredSections: string[];
  receivedSections: string[];
  gaps:             IGap[];
  recommendation:   string;
  analysedAt:       Date | null;
}

export interface IEmailDraft {
  status:    WorkStatus;
  error:     string;
  subject:   string;
  body:      string;
  draftedAt: Date | null;
}

export interface IStage3Work extends Document {
  inquiryId:   string;
  gapAnalysis: IGapAnalysis;
  emailDraft:  IEmailDraft;
  createdAt:   Date;
  updatedAt:   Date;
}

const GapSchema = new Schema<IGap>(
  { section: String, reason: String, severity: { type: String, enum: ['critical', 'major', 'minor'] } },
  { _id: false },
);

const GapAnalysisSchema = new Schema<IGapAnalysis>(
  {
    status:           { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:            { type: String, default: '' },
    requiredSections: { type: [String], default: [] },
    receivedSections: { type: [String], default: [] },
    gaps:             { type: [GapSchema], default: [] },
    recommendation:   { type: String, default: '' },
    analysedAt:       { type: Date, default: null },
  },
  { _id: false },
);

const EmailDraftSchema = new Schema<IEmailDraft>(
  {
    status:    { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:     { type: String, default: '' },
    subject:   { type: String, default: '' },
    body:      { type: String, default: '' },
    draftedAt: { type: Date, default: null },
  },
  { _id: false },
);

const Stage3WorkSchema = new Schema<IStage3Work>(
  {
    inquiryId:   { type: String, required: true, unique: true, index: true },
    gapAnalysis: { type: GapAnalysisSchema, default: () => ({}) },
    emailDraft:  { type: EmailDraftSchema,  default: () => ({}) },
  },
  { timestamps: true },
);

export const Stage3Work = mongoose.model<IStage3Work>('Stage3Work', Stage3WorkSchema);
