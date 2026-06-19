import mongoose, { Schema, Document } from 'mongoose';

export interface IInquiry extends Document {
  inquiryId: string;
  client: string;
  project: string;
  scope: string;
  value: number;
  currency: 'USD' | 'INR';
  valueUnit: 'Mn' | 'Cr';
  priority: 'P1' | 'P2' | 'P3';
  currentStage: number;
  currentStageName: string;
  cluster: 'intake' | 'estimation' | 'proposal' | 'bid_active' | 'outcome';
  daysToBid: number;
  bidDue: string;
  receivedDate: string;
  source: string;
  estimator: string;
  completedUpTo: number;
  createdAt: Date;
  updatedAt: Date;
}

const InquirySchema = new Schema<IInquiry>(
  {
    inquiryId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    client: { type: String, required: true },
    project: { type: String, required: true },
    scope: { type: String, required: true },
    value: { type: Number, required: true },
    currency: { type: String, enum: ['USD', 'INR'], required: true },
    valueUnit: { type: String, enum: ['Mn', 'Cr'], required: true },
    priority: { type: String, enum: ['P1', 'P2', 'P3'], required: true },
    currentStage: { type: Number, required: true },
    currentStageName: { type: String, required: true },
    cluster: {
      type: String,
      enum: ['intake', 'estimation', 'proposal', 'bid_active', 'outcome'],
      required: true,
    },
    daysToBid: { type: Number, required: true },
    bidDue: { type: String, required: true },
    receivedDate: { type: String, required: true },
    source: { type: String, required: true },
    estimator: { type: String, required: true },
    completedUpTo: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Inquiry = mongoose.model<IInquiry>('Inquiry', InquirySchema);
