import mongoose, { Schema, Document } from 'mongoose';

export interface ISearchChatMessage {
  role: 'user' | 'model';
  text: string;
  sources: { docId: string; title: string; inquiryId: string; pages: number[] }[];
}

export interface ISearchChat extends Document {
  title: string;
  scopeTenderNames: string[];
  messages: ISearchChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const SearchChatSchema = new Schema<ISearchChat>(
  {
    title: { type: String, default: 'New chat' },
    scopeTenderNames: { type: [String], default: [] },
    messages: {
      type: [
        {
          role:    { type: String, enum: ['user', 'model'], required: true },
          text:    { type: String, default: '' },
          sources: { type: Schema.Types.Mixed, default: [] },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: 'search_chats' },
);

export const SearchChat = mongoose.model<ISearchChat>('SearchChat', SearchChatSchema);
