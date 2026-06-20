import mongoose, { Schema, Document } from 'mongoose';

export interface IStage8Work extends Document {
  inquiryId:  string;
  title:      string;
  body:       string;   // full Markdown proposal
  status:     'pending' | 'processing' | 'done' | 'failed';
  error:      string;
  draftedAt:  Date | null;
  editedAt:   Date | null;  // set when user manually edits after generation
  createdAt:  Date;
  updatedAt:  Date;
}

const Stage8WorkSchema = new Schema<IStage8Work>(
  {
    inquiryId: { type: String, required: true, unique: true, index: true },
    title:     { type: String, default: '' },
    body:      { type: String, default: '' },
    status:    { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:     { type: String, default: '' },
    draftedAt: { type: Date, default: null },
    editedAt:  { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage8Work = mongoose.model<IStage8Work>('Stage8Work', Stage8WorkSchema);
