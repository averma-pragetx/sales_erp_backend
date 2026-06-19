import mongoose, { Schema, Document } from 'mongoose';

export interface IExtractedSection {
  title: string;
  content: string;
  summary: string;
}

export interface IDocument extends Document {
  // Core
  inquiryId: string;
  docType: string;
  title: string;
  rev: string;
  status: 'read' | 'open' | 'queued';

  // Storage
  s3Key: string;
  s3Bucket: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;

  // Gemini AI processing
  processingStatus: 'pending' | 'processing' | 'done' | 'failed';
  processingError: string;

  // Gemini output
  aiSummary: string;
  keyItems: string[];
  extractedSections: IExtractedSection[];

  createdAt: Date;
  updatedAt: Date;
}

const ExtractedSectionSchema = new Schema<IExtractedSection>(
  {
    title:   { type: String, default: '' },
    content: { type: String, default: '' },
    summary: { type: String, default: '' },
  },
  { _id: false }
);

const DocumentSchema = new Schema<IDocument>(
  {
    inquiryId: { type: String, required: true, index: true },
    docType:   { type: String, required: true },
    title:     { type: String, required: true },
    rev:       { type: String, required: true },
    status:    { type: String, enum: ['read', 'open', 'queued'], required: true },

    s3Key:      { type: String, default: '' },
    s3Bucket:   { type: String, default: '' },
    fileName:   { type: String, default: '' },
    fileSize:   { type: Number, default: 0 },
    mimeType:   { type: String, default: '' },
    uploadedBy: { type: String, default: 'system' },

    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
    },
    processingError: { type: String, default: '' },

    aiSummary:         { type: String, default: '' },
    keyItems:          { type: [String], default: [] },
    extractedSections: { type: [ExtractedSectionSchema], default: [] },
  },
  { timestamps: true }
);

export const Doc = mongoose.model<IDocument>('Document', DocumentSchema);
