import mongoose, { Schema, Document } from 'mongoose';

export type TQStatus = 'draft' | 'sent' | 'answered';

export interface ITechQuery extends Document {
  inquiryId:   string;
  tqIndex:     number;     // 1, 2, 3… — unique within inquiry, drives sort order
  tqNumber:    string;     // "TQ-01", "TQ-02"… — denormalised for display
  tagClause:   string;     // TAG / model number ref (e.g. "300-EE-00-2201 A/B" or "–")
  clauseRef:   string;     // secondary clause / datasheet ref (e.g. "DS-4033 Sh.2")
  question:    string;
  answer:      string;     // populated when status → answered
  sendTo:      string;     // recipient org/person
  raisedBy:    string;     // initials / name of person who raised it
  status:      TQStatus;
  sentAt:      Date | null;
  answeredAt:  Date | null;
  createdAt:   Date;
  updatedAt:   Date;
}

const TechQuerySchema = new Schema<ITechQuery>(
  {
    inquiryId:  { type: String, required: true, index: true },
    tqIndex:    { type: Number, required: true },
    tqNumber:   { type: String, required: true },
    tagClause:  { type: String, default: '–' },
    clauseRef:  { type: String, default: '' },
    question:   { type: String, required: true },
    answer:     { type: String, default: '' },
    sendTo:     { type: String, required: true },
    raisedBy:   { type: String, required: true },
    status:     { type: String, enum: ['draft', 'sent', 'answered'], default: 'draft' },
    sentAt:     { type: Date, default: null },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Unique index: no two TQs can share the same index within an inquiry
TechQuerySchema.index({ inquiryId: 1, tqIndex: 1 }, { unique: true });

export const TechQuery = mongoose.model<ITechQuery>('TechQuery', TechQuerySchema);
