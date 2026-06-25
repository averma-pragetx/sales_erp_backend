import mongoose, { Schema, Document } from 'mongoose';

export interface IComplianceMeta {
  tclDocumentRef:       string;
  tclRevision:          string;
  totalComplianceItems: number;
  compliantCount:       number;
  deviationCount:       number;
  openUnderReviewCount: number;
  blockerCount:         number;
  categories:           string[];
}

export interface IComplianceItem {
  clauseId:            string;
  sourceRef:           string;
  topic:               string;
  category:            string;
  rfqBuyerRequirement: string;
  oswalStandOffer:     string;
  impact:              string;
  status:              string;
  owner:               string;
  compliantFlag:       boolean;
  deviationFlag:       boolean;
  blockerFlag:         boolean;
  openFlag:            boolean;
  statusOverride:      string | null;
  ownerOverride:       string | null;
  remarks:             string;
}

export interface IStage5Work extends Document {
  inquiryId:        string;
  status:           'pending' | 'processing' | 'done' | 'failed';
  error:            string;
  complianceMeta:   IComplianceMeta;
  complianceMatrix: IComplianceItem[];
  analyzedAt:       Date | null;
  createdAt:        Date;
  updatedAt:        Date;
}

const ComplianceMetaSchema = new Schema<IComplianceMeta>(
  {
    tclDocumentRef:       { type: String, default: '' },
    tclRevision:          { type: String, default: '' },
    totalComplianceItems: { type: Number, default: 0 },
    compliantCount:       { type: Number, default: 0 },
    deviationCount:       { type: Number, default: 0 },
    openUnderReviewCount: { type: Number, default: 0 },
    blockerCount:         { type: Number, default: 0 },
    categories:           { type: [String], default: [] },
  },
  { _id: false },
);

const ComplianceItemSchema = new Schema<IComplianceItem>(
  {
    clauseId:            { type: String, default: '' },
    sourceRef:           { type: String, default: '' },
    topic:               { type: String, default: '' },
    category:            { type: String, default: '' },
    rfqBuyerRequirement: { type: String, default: '' },
    oswalStandOffer:     { type: String, default: '' },
    impact:              { type: String, default: '' },
    status:              { type: String, default: 'Under review' },
    owner:               { type: String, default: '' },
    compliantFlag:       { type: Boolean, default: false },
    deviationFlag:       { type: Boolean, default: false },
    blockerFlag:         { type: Boolean, default: false },
    openFlag:            { type: Boolean, default: false },
    statusOverride:      { type: String, default: null },
    ownerOverride:       { type: String, default: null },
    remarks:             { type: String, default: '' },
  },
  { _id: false },
);

const Stage5WorkSchema = new Schema<IStage5Work>(
  {
    inquiryId:        { type: String, required: true, unique: true, index: true },
    status:           { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:            { type: String, default: '' },
    complianceMeta:   { type: ComplianceMetaSchema, default: () => ({}) },
    complianceMatrix: { type: [ComplianceItemSchema], default: [] },
    analyzedAt:       { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage5Work = mongoose.model<IStage5Work>('Stage5Work', Stage5WorkSchema);
