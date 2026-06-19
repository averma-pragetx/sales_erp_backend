import mongoose, { Schema, Document } from 'mongoose';

export interface IDocument extends Document {
  inquiryId: string;
  docType: string;
  title: string;
  rev: string;
  status: 'read' | 'open' | 'queued';
  s3Key: string;
  s3Bucket: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>(
  {
    inquiryId: {
      type: String,
      required: true,
      index: true,
    },
    docType: { type: String, required: true },
    title: { type: String, required: true },
    rev: { type: String, required: true },
    status: {
      type: String,
      enum: ['read', 'open', 'queued'],
      required: true,
    },
    s3Key: { type: String, default: '' },
    s3Bucket: { type: String, default: '' },
    fileName: { type: String, default: '' },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: '' },
    uploadedBy: { type: String, default: 'system' },
  },
  { timestamps: true }
);

export const Doc = mongoose.model<IDocument>('Document', DocumentSchema);
