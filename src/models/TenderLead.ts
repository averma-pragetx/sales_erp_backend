import mongoose, { Schema, Document } from 'mongoose';

export interface ITenderLead extends Document {
  tenderName: string;
  scraperId: string;
  pdfS3Key: string;
  zipS3Key: string;
  tenderId: string;
  client: string;
  title: string;
  source: string;
  value: number;
  currency: 'USD' | 'INR';
  valueUnit: 'Mn' | 'Cr';
  dueDate: string;
  score: number | null;
  analysed: boolean;
  status: 'new' | 'approved' | 'rejected' | 'pushed';
  pushedInquiryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TenderLeadSchema = new Schema<ITenderLead>(
  {
    tenderName: { type: String, required: true, index: true, unique: true },
    scraperId:  { type: String, default: '', index: true },
    pdfS3Key:   { type: String, default: '' },
    zipS3Key:   { type: String, default: '' },
    tenderId:   { type: String, default: '' },
    client:     { type: String, default: '' },
    title:      { type: String, default: '' },
    source:     { type: String, default: '' },
    value:      { type: Number, default: 0 },
    currency:   { type: String, enum: ['USD', 'INR'], default: 'INR' },
    valueUnit:  { type: String, enum: ['Mn', 'Cr'], default: 'Cr' },
    dueDate:    { type: String, default: '' },
    score:      { type: Number, default: null },
    analysed:   { type: Boolean, default: false },
    status:     { type: String, enum: ['new', 'approved', 'rejected', 'pushed'], default: 'new' },
    pushedInquiryId: { type: String, default: null },
  },
  { timestamps: true, collection: 'tender_leads' }
);

export const TenderLead = mongoose.model<ITenderLead>('TenderLead', TenderLeadSchema);
