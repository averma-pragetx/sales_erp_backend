import mongoose, { Schema, Document } from 'mongoose';

export interface ITagItem {
  tagNumber:     string;   // TAG / serial / model number; "not specified" if absent
  productName:   string;   // Equipment description; "not specified" if absent
  dimensions:    string;   // e.g. "ID 600mm × L 3000mm"; "not specified" if absent
  weightPerUnit: string;   // e.g. "850 kg"; "not specified" if absent
  quantity:      string;   // e.g. "4" or "4 nos"; "not specified" if absent
  notes:         string;   // Any extra text from the row (material, service, etc.)
  missingFields: string[]; // Field names that were explicitly not found
}

export interface IStage4Work extends Document {
  inquiryId:            string;
  sourceDocumentId:     mongoose.Types.ObjectId | null;
  sourceDocumentTitle:  string;
  tags:                 ITagItem[];
  extractionNotes:      string;  // Gemini's commentary on extraction quality
  status:               'pending' | 'processing' | 'done' | 'failed';
  error:                string;
  extractedAt:          Date | null;
  createdAt:            Date;
  updatedAt:            Date;
}

const TagItemSchema = new Schema<ITagItem>(
  {
    tagNumber:     { type: String, default: 'not specified' },
    productName:   { type: String, default: 'not specified' },
    dimensions:    { type: String, default: 'not specified' },
    weightPerUnit: { type: String, default: 'not specified' },
    quantity:      { type: String, default: 'not specified' },
    notes:         { type: String, default: '' },
    missingFields: { type: [String], default: [] },
  },
  { _id: false },
);

const Stage4WorkSchema = new Schema<IStage4Work>(
  {
    inquiryId:           { type: String, required: true, unique: true, index: true },
    sourceDocumentId:    { type: Schema.Types.ObjectId, ref: 'Doc', default: null },
    sourceDocumentTitle: { type: String, default: '' },
    tags:                { type: [TagItemSchema], default: [] },
    extractionNotes:     { type: String, default: '' },
    status:              { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:               { type: String, default: '' },
    extractedAt:         { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage4Work = mongoose.model<IStage4Work>('Stage4Work', Stage4WorkSchema);
