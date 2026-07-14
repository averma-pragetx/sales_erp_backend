import mongoose, { Schema, Document } from 'mongoose';

export interface IScrapedFile {
  fileName: string;
  s3Key: string;
  mimeType: string;
  fileSize: number;
}

export interface IScrapedTender extends Document {
  tenderName: string;
  files: IScrapedFile[];
  createdAt: Date;
  updatedAt: Date;
}

const ScrapedFileSchema = new Schema<IScrapedFile>(
  {
    fileName: { type: String, required: true },
    s3Key:    { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
  },
  { _id: false }
);

const ScrapedTenderSchema = new Schema<IScrapedTender>(
  {
    tenderName: { type: String, required: true, index: true, unique: true },
    files:      [ScrapedFileSchema],
  },
  { timestamps: true, collection: 'scraped_tenders' }
);

export const ScrapedTender = mongoose.model<IScrapedTender>('ScrapedTender', ScrapedTenderSchema);
