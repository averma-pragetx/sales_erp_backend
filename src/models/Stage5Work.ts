import mongoose, { Schema, Document } from 'mongoose';

export interface IStage5Work extends Document {
  inquiryId:    string;
  checkedItems: boolean[];  // index-aligned with TECH_CHECKLIST
  createdAt:    Date;
  updatedAt:    Date;
}

const Stage5WorkSchema = new Schema<IStage5Work>(
  {
    inquiryId:    { type: String, required: true, unique: true, index: true },
    checkedItems: { type: [Boolean], default: [] },
  },
  { timestamps: true },
);

export const Stage5Work = mongoose.model<IStage5Work>('Stage5Work', Stage5WorkSchema);
