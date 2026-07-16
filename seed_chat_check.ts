import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });
import mongoose from 'mongoose';
import { SearchChat } from './src/models/SearchChat';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI as string);
  const chat = await SearchChat.create({
    title: 'seed test chat',
    messages: [
      { role: 'user', text: 'q1', sources: [] },
      { role: 'model', text: 'a1', sources: [{ docId: 'x', title: 'EPC', inquiryId: 'OEL/EST/2026/0407', pages: [1, 2] }] },
    ],
  });
  console.log('created', String(chat._id));
  await mongoose.disconnect();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
