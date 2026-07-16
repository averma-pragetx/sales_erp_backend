import { Router, Request, Response } from 'express';
import { Scraper } from '../models/Scraper';

const router = Router();

// Collection has a stale unique `code_1` index from a previous schema — syncIndexes drops it
let indexesSynced: Promise<unknown> | null = null;

// The two scrapers that exist today (scraper/scrape.js and scraper/scrape_cppp.js).
// Run/schedule metadata is static placeholder until scrapers report real runs.
const DEFAULT_SCRAPERS = [
  {
    scraperId: 'GEM-OG-01',
    name: 'GeM',
    sourceUrl: 'https://gem.gov.in/cppp_state/1',
    script: 'scraper/scrape.js',
    target: 'Oil & Gas tenders, mech package',
    actor: 'oswal/gem-watch',
    cron: 'Every 6h · 06:00-22:00 IST',
    lastRun: '14 July, 22:00',
    nextRun: '15 July, 04:00',
    runtime: '2m 35s',
    status: 'running',
    leads24h: 19,
    qualified24h: 2,
    quotaPct: 77,
  },
  {
    scraperId: 'CPPP-ONGC-02',
    name: 'CPPP',
    errorMsg: 'manual re-login needed',
    sourceUrl: 'https://eprocure.gov.in/cppp',
    script: 'scraper/scrape_cppp.js',
    target: 'ONGC tenders via CPPP e-procurement',
    actor: 'oswal/cppp-watch',
    cron: 'Every 6h',
    lastRun: '14 July, 16:22',
    nextRun: '15 July, 10:22',
    runtime: '2m 24s',
    status: 'error',
    leads24h: 14,
    qualified24h: 1,
    quotaPct: 41,
  },
];

router.get('/', async (_req: Request, res: Response) => {
  try {
    if (!indexesSynced) {
      indexesSynced = Scraper.syncIndexes().catch(err => { indexesSynced = null; throw err; });
    }
    await indexesSynced;
    // Drop docs from the earlier name-only schema — they'd break the unique scraperId index
    await Scraper.deleteMany({ scraperId: { $exists: false } });
    for (const s of DEFAULT_SCRAPERS) {
      await Scraper.updateOne({ scraperId: s.scraperId }, { $set: s }, { upsert: true });
    }
    const scrapers = await Scraper.find().sort({ createdAt: 1 });
    res.json(scrapers.map(s => ({
      scraperId: s.scraperId,
      name: s.name,
      sourceUrl: s.sourceUrl,
      script: s.script,
      target: s.target,
      actor: s.actor,
      cron: s.cron,
      lastRun: s.lastRun,
      nextRun: s.nextRun,
      runtime: s.runtime,
      status: s.status,
      errorMsg: s.errorMsg,
      leads24h: s.leads24h,
      qualified24h: s.qualified24h,
      quotaPct: s.quotaPct,
    })));
  } catch (error) {
    console.error('Error fetching scrapers:', error);
    res.status(500).json({ error: 'Failed to fetch scrapers' });
  }
});

export default router;
