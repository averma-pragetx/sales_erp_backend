import path from 'path';
import dotenv from 'dotenv';

// Load .env from backend/ directory (parent of src/)
dotenv.config({ path: path.join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import { connectDB } from './db';
import inquiriesRouter from './routes/inquiries';
import documentsRouter from './routes/documents';

const app = express();
const PORT = process.env.PORT ?? 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/inquiries', inquiriesRouter);
app.use('/api/documents', documentsRouter);

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
