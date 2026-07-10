import mongoose, { Schema, Document } from 'mongoose';
import type { IPageIndexNode } from './PageIndexTree';

// Append-only audit log for PageIndexTree — every build/repair writes a new
// row here instead of overwriting history, so the original AI-built tree and
// every edited revision after it stay retrievable. Deliberately excludes
// pageTexts (the expensive field, unchanged by repair and identical across
// most builds of the same file) — only the structure map itself is versioned.

export interface IPageIndexTreeVersion extends Document {
  documentId: mongoose.Types.ObjectId;
  versionNumber: number; // 1-based, increments per document

  action:   'build' | 'repair';
  provider: 'gemini' | 'openai';

  pageCount:    number;
  docSummary:   string;
  tree:         IPageIndexNode[];
  qualityFlags: string[];

  createdAt: Date;
}

const PageIndexTreeVersionSchema = new Schema<IPageIndexTreeVersion>(
  {
    documentId:    { type: Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
    versionNumber: { type: Number, required: true },

    action:   { type: String, enum: ['build', 'repair'], required: true },
    provider: { type: String, enum: ['gemini', 'openai'], required: true },

    pageCount:    { type: Number, default: 0 },
    docSummary:   { type: String, default: '' },
    tree:         { type: Schema.Types.Mixed, default: [] },
    qualityFlags: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Fast "history for this document, newest first" lookup
PageIndexTreeVersionSchema.index({ documentId: 1, versionNumber: -1 });

export const PageIndexTreeVersion = mongoose.model<IPageIndexTreeVersion>(
  'PageIndexTreeVersion',
  PageIndexTreeVersionSchema,
);
