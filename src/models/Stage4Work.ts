import mongoose, { Schema, Document } from 'mongoose';

export interface IShellTubeSide {
  fluid:                  string;
  operatingPressureBarg:  number;
  designPressureBarg:     number;
  operatingTempC:         number;
  designTempC:            number;
  material:               string;
}

export interface ITagItem {
  tagNumber:       string;
  service:         string;
  temaType:        string;
  shellOdMm:       number;
  tubeLengthMm:    number;
  nos:             number;
  shellSide:       IShellTubeSide;
  tubeSide:        IShellTubeSide;
  weightPerUnitT:  number;
  totalWeightT:    number;
  datasheetRef:    string;
  datasheetRev:    string;
  ltcs:            boolean;
  ibr:             boolean;
  pwht:            boolean;
  ndeRequirements: string[];
  deviations:      string[];
  openItems:       string[];
  specialNotes:    string[];
}

export interface IExtractionMeta {
  sourceDocuments:         string[];
  totalTagsFound:          number;
  totalUnits:              number;
  ltcsItemCount:           number;
  totalFabricationWeightT: number;
}

export interface IStage4Work extends Document {
  inquiryId:            string;
  sourceDocumentId:     mongoose.Types.ObjectId | null;
  sourceDocumentTitle:  string;
  tags:                 ITagItem[];
  extractionMeta:       IExtractionMeta;
  extractionNotes:      string;
  status:               'pending' | 'processing' | 'done' | 'failed';
  error:                string;
  extractedAt:          Date | null;
  createdAt:            Date;
  updatedAt:            Date;
}

const ShellTubeSideSchema = new Schema<IShellTubeSide>(
  {
    fluid:                 { type: String, default: '' },
    operatingPressureBarg: { type: Number, default: 0 },
    designPressureBarg:    { type: Number, default: 0 },
    operatingTempC:        { type: Number, default: 0 },
    designTempC:           { type: Number, default: 0 },
    material:              { type: String, default: '' },
  },
  { _id: false },
);

const TagItemSchema = new Schema<ITagItem>(
  {
    tagNumber:       { type: String, default: '' },
    service:         { type: String, default: '' },
    temaType:        { type: String, default: '' },
    shellOdMm:       { type: Number, default: 0 },
    tubeLengthMm:    { type: Number, default: 0 },
    nos:             { type: Number, default: 1 },
    shellSide:       { type: ShellTubeSideSchema, default: () => ({}) },
    tubeSide:        { type: ShellTubeSideSchema, default: () => ({}) },
    weightPerUnitT:  { type: Number, default: 0 },
    totalWeightT:    { type: Number, default: 0 },
    datasheetRef:    { type: String, default: '' },
    datasheetRev:    { type: String, default: '' },
    ltcs:            { type: Boolean, default: false },
    ibr:             { type: Boolean, default: false },
    pwht:            { type: Boolean, default: false },
    ndeRequirements: { type: [String], default: [] },
    deviations:      { type: [String], default: [] },
    openItems:       { type: [String], default: [] },
    specialNotes:    { type: [String], default: [] },
  },
  { _id: false },
);

const ExtractionMetaSchema = new Schema<IExtractionMeta>(
  {
    sourceDocuments:         { type: [String], default: [] },
    totalTagsFound:          { type: Number, default: 0 },
    totalUnits:              { type: Number, default: 0 },
    ltcsItemCount:           { type: Number, default: 0 },
    totalFabricationWeightT: { type: Number, default: 0 },
  },
  { _id: false },
);

const Stage4WorkSchema = new Schema<IStage4Work>(
  {
    inquiryId:           { type: String, required: true, unique: true, index: true },
    sourceDocumentId:    { type: Schema.Types.ObjectId, ref: 'Doc', default: null },
    sourceDocumentTitle: { type: String, default: '' },
    tags:                { type: [TagItemSchema], default: [] },
    extractionMeta:      { type: ExtractionMetaSchema, default: () => ({}) },
    extractionNotes:     { type: String, default: '' },
    status:              { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:               { type: String, default: '' },
    extractedAt:         { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage4Work = mongoose.model<IStage4Work>('Stage4Work', Stage4WorkSchema);
