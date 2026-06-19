import path from 'path';
import dotenv from 'dotenv';

// Load .env from backend/ directory (parent of src/)
dotenv.config({ path: path.join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import { connectDB } from './db';
import inquiriesRouter from './routes/inquiries';
import documentsRouter from './routes/documents';
import extractRouter from './routes/extract';
import sectionsRouter from './routes/sections';
import stage3Router   from './routes/stage3';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/inquiries', inquiriesRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/extract',   extractRouter);
app.use('/api/sections',  sectionsRouter);
app.use('/api/stage3',    stage3Router);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start(): Promise<void> {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
