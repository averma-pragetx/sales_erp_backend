import mongoose, { Schema, Document } from 'mongoose';

export interface IBomItem {
  _id:          mongoose.Types.ObjectId;
  tagNumber:    string;   // from Stage 4 (or manually entered)
  productName:  string;   // item description
  quantity:     number;   // numeric quantity
  quantityUnit: string;   // "nos", "sets", "lot", etc.
  rateInr:      number;   // rate per unit in INR
  totalInr:     number;   // rateInr × quantity (stored for fast reads)
  aiEstimated:  boolean;  // true = AI provided the rate; false = manual override
  rationale:    string;   // AI's 1-sentence reasoning
  confidence:   string;   // "high" | "medium" | "low" | "manual"
  mocType:          string;   // Material of Construction / type (e.g. "CS", "SS 316L")
  notes:        string;
  remarks:      string;   // free-text remarks entered by the user
}

export interface IStage7Work extends Document {
  inquiryId:     string;
  items:         IBomItem[];
  grandTotalInr: number;
  status:        'pending' | 'processing' | 'done' | 'failed';
  error:         string;
  estimatedAt:   Date | null;
  createdAt:     Date;
  updatedAt:     Date;
}

const BomItemSchema = new Schema<IBomItem>(
  {
    tagNumber:    { type: String, default: '' },
    productName:  { type: String, required: true },
    quantity:     { type: Number, default: 1, min: 0 },
    quantityUnit: { type: String, default: 'nos' },
    rateInr:      { type: Number, default: 0, min: 0 },
    totalInr:     { type: Number, default: 0 },
    aiEstimated:  { type: Boolean, default: false },
    rationale:    { type: String, default: '' },
    confidence:   { type: String, default: '' },
    mocType:          { type: String, default: '' },
    notes:        { type: String, default: '' },
    remarks:      { type: String, default: '' },
  },
  { _id: true },
);

const Stage7WorkSchema = new Schema<IStage7Work>(
  {
    inquiryId:     { type: String, required: true, unique: true, index: true },
    items:         { type: [BomItemSchema], default: [] },
    grandTotalInr: { type: Number, default: 0 },
    status:        { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:         { type: String, default: '' },
    estimatedAt:   { type: Date, default: null },
  },
  { timestamps: true },
);

export const Stage7Work = mongoose.model<IStage7Work>('Stage7Work', Stage7WorkSchema);
