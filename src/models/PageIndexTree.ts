import mongoose, { Schema, Document } from 'mongoose';

export interface IPageIndexNode {
  nodeId:    string;
  title:     string;
  startPage: number;
  endPage:   number;
  summary:   string;
  nodes:     IPageIndexNode[];
}

export interface IPageIndexTree extends Document {
  documentId: mongoose.Types.ObjectId;
  inquiryId:  string;

  status: 'pending' | 'processing' | 'done' | 'failed';
  error:  string;
  provider: 'gemini' | 'openai' | 'claude';

  pageCount:  number;
  docSummary: string;
  tree:       IPageIndexNode[];
  pageTexts:  string[]; // pageTexts[0] = page 1
  qualityFlags: string[]; // build-time warnings: coverage gaps, bad ranges, thin summaries, truncated input
  currentVersion: number; // mirrors the latest row in PageIndexTreeVersion — 0 until the first build completes

  builtAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const PageIndexTreeSchema = new Schema<IPageIndexTree>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true, unique: true, index: true },
    inquiryId:  { type: String, required: true, index: true },

    status:   { type: String, enum: ['pending', 'processing', 'done', 'failed'], default: 'pending' },
    error:    { type: String, default: '' },
    provider: { type: String, enum: ['gemini', 'openai', 'claude'], default: 'gemini' },

    pageCount:  { type: Number, default: 0 },
    docSummary: { type: String, default: '' },
    // ponytail: recursive tree JSON, never queried by field — Mixed avoids a
    // hand-rolled self-referential Mongoose schema for a blob we only read/write whole.
    tree:       { type: Schema.Types.Mixed, default: [] },
    pageTexts:  { type: [String], default: [] },
    qualityFlags: { type: [String], default: [] },
    currentVersion: { type: Number, default: 0 },

    builtAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const PageIndexTree = mongoose.model<IPageIndexTree>('PageIndexTree', PageIndexTreeSchema);
