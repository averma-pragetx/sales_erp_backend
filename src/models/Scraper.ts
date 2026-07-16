import mongoose, { Schema, Document } from 'mongoose';

export interface IScraper extends Document {
  scraperId: string;
  name: string;
  sourceUrl: string;
  script: string;
  target: string;
  actor: string;
  cron: string;
  lastRun: string;
  nextRun: string;
  runtime: string;
  status: 'running' | 'idle' | 'error';
  errorMsg: string;
  leads24h: number;
  qualified24h: number;
  quotaPct: number;
  createdAt: Date;
  updatedAt: Date;
}

const ScraperSchema = new Schema<IScraper>(
  {
    scraperId: { type: String, required: true, unique: true },
    name:      { type: String, required: true },
    sourceUrl: { type: String, default: '' },
    script:    { type: String, default: '' },
    target:    { type: String, default: '' },
    actor:     { type: String, default: '' },
    cron:      { type: String, default: '' },
    lastRun:   { type: String, default: '' },
    nextRun:   { type: String, default: '' },
    runtime:   { type: String, default: '' },
    status:    { type: String, enum: ['running', 'idle', 'error'], default: 'idle' },
    errorMsg:  { type: String, default: '' },
    leads24h:     { type: Number, default: 0 },
    qualified24h: { type: Number, default: 0 },
    quotaPct:     { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'scrapers' }
);

export const Scraper = mongoose.model<IScraper>('Scraper', ScraperSchema);
