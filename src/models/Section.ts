import mongoose, { Schema, Document } from 'mongoose';

export interface ISection extends Document {
  // Lineage
  inquiryId:     string;
  documentId:    mongoose.Types.ObjectId;

  // Denormalised for display without joins
  docType:       string;
  documentTitle: string;

  // Content
  sectionIndex:  number;   // order of section within the document
  title:         string;
  content:       string;
  summary:       string;

  // Stage 2 review
  reviewDecision: 'pending' | 'ok' | 'flagged' | 'issue';
  reviewNote:     string;

  createdAt: Date;
  updatedAt: Date;
}

const SectionSchema = new Schema<ISection>(
  {
    inquiryId:     { type: String,                          required: true, index: true },
    documentId:    { type: Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    docType:       { type: String, default: '' },
    documentTitle: { type: String, default: '' },
    sectionIndex:  { type: Number, default: 0 },
    title:         { type: String, required: true },
    content:       { type: String, default: '' },
    summary:       { type: String, default: '' },
    reviewDecision: { type: String, enum: ['pending', 'ok', 'flagged', 'issue'], default: 'pending' },
    reviewNote:     { type: String, default: '' },
  },
  { timestamps: true },
);

// Compound index — fast lookup for "all sections of a document" in order
SectionSchema.index({ documentId: 1, sectionIndex: 1 });

export const Section = mongoose.model<ISection>('Section', SectionSchema);
