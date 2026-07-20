import path from 'path';
import dotenv from 'dotenv';

// Load .env from backend/ directory (parent of src/)
dotenv.config({ path: path.join(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import { connectDB } from './db';
import { logger } from './logger';
import inquiriesRouter from './routes/inquiries';
import scrapedTendersRouter from './routes/scrapedTenders';
import scrapersRouter from './routes/scrapers';
import documentsRouter from './routes/documents';
import extractRouter from './routes/extract';
import sectionsRouter from './routes/sections';
import stage3Router   from './routes/stage3';
import stage4Router   from './routes/stage4';
import stage5Router   from './routes/stage5';
import stage6Router   from './routes/stage6';
import stage7Router   from './routes/stage7';
import stage8Router   from './routes/stage8';
import pageIndexRouter from './routes/pageIndex';
import searchRouter from './routes/search';

const app = express();
const PORT = process.env.PORT ?? 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use('/api/inquiries', inquiriesRouter);
app.use('/api/scraped-tenders', scrapedTendersRouter);
app.use('/api/scrapers', scrapersRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/extract',   extractRouter);
app.use('/api/sections',  sectionsRouter);
app.use('/api/stage3',    stage3Router);
app.use('/api/stage4',    stage4Router);
app.use('/api/stage5',    stage5Router);
app.use('/api/stage6',    stage6Router);
app.use('/api/stage7',    stage7Router);
app.use('/api/stage8',    stage8Router);
app.use('/api/pageindex', pageIndexRouter);
app.use('/api/search',    searchRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start(): Promise<void> {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
