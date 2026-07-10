import mongoose, { Schema, Document } from 'mongoose';

export interface ILead extends Document {
  leadId: string;
  client: string;
  clientType: string;
  tenderRef: string;
  title: string;
  source: string;
  value: number;
  currency: 'USD' | 'INR';
  valueUnit: 'Mn' | 'Cr';
  dueDate: string;
  avlStatus: 'approved' | 'not_registered' | 'review';
  score: number | null;
  assignedTo: string;
  notes: string;
  status: 'new' | 'approved' | 'rejected' | 'pushed';
  pushedInquiryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    leadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    client: { type: String, required: true },
    clientType: { type: String, default: '' },
    tenderRef: { type: String, default: '' },
    title: { type: String, required: true },
    source: { type: String, required: true },
    value: { type: Number, required: true },
    currency: { type: String, enum: ['USD', 'INR'], required: true },
    valueUnit: { type: String, enum: ['Mn', 'Cr'], required: true },
    dueDate: { type: String, required: true },
    avlStatus: {
      type: String,
      enum: ['approved', 'not_registered', 'review'],
      default: 'not_registered',
    },
    score: { type: Number, default: null },
    assignedTo: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['new', 'approved', 'rejected', 'pushed'],
      default: 'new',
    },
    pushedInquiryId: { type: String, default: null },
  },
  { timestamps: true }
);

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);
