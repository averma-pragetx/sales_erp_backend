import assert from 'node:assert';
import { validateTree, searchDocument, summarizeRanges, isFixableFlag } from './pageIndex';
import type { IPageIndexNode } from '../models/PageIndexTree';

// Run: npx tsx src/services/pageIndex.selfcheck.ts
// Covers the deterministic retrieval/validation helpers (no API calls).

function node(p: Partial<IPageIndexNode>): IPageIndexNode {
  return { nodeId: 'x', title: 't', startPage: 1, endPage: 1, summary: 'word '.repeat(25), nodes: [], ...p };
}

// summarizeRanges compresses consecutive pages
assert.equal(summarizeRanges([1, 2, 3, 7, 9, 10]), '1–3, 7, 9–10');
assert.equal(summarizeRanges([5]), '5');
assert.equal(summarizeRanges([]), '');

// searchDocument: case-insensitive, reports page numbers, handles misses
const pages = ['intro about pumps', 'TAG-101 design pressure 10 barg', 'nothing relevant here'];
assert.ok(searchDocument(pages, 'tag-101').includes('Page 2'), 'locates TAG-101 on page 2');
assert.ok(searchDocument(pages, 'zzz').toLowerCase().includes('no matches'), 'reports miss');
assert.ok(searchDocument(pages, '   ').includes('No search query'), 'rejects empty query');

// validateTree: clean single section covering the whole doc → no flags
assert.deepEqual(
  validateTree([node({ startPage: 1, endPage: 3 })], 3, false),
  [],
);

// validateTree: uncovered pages flagged
assert.ok(
  validateTree([node({ startPage: 1, endPage: 1 })], 3, false).some(f => f.includes('not covered')),
  'flags coverage gap',
);

// validateTree: short summary flagged
assert.ok(
  validateTree([node({ startPage: 1, endPage: 3, summary: 'too short' })], 3, false).some(f => f.includes('short summary')),
  'flags thin summary',
);

// validateTree: inverted range flagged
assert.ok(
  validateTree([node({ startPage: 3, endPage: 1, summary: 'word '.repeat(25) })], 3, false).some(f => f.includes('startPage > endPage')),
  'flags inverted range',
);

// validateTree: large sibling overlap flagged
const overlap = validateTree(
  [node({ title: 'A', startPage: 1, endPage: 8 }), node({ title: 'B', startPage: 2, endPage: 10 })],
  10,
  false,
);
assert.ok(overlap.some(f => f.includes('overlap')), 'flags large overlap');

// validateTree: truncated input flagged
assert.ok(
  validateTree([node({ startPage: 1, endPage: 3 })], 3, true).some(f => f.includes('analysis limit')),
  'flags truncated input',
);

// isFixableFlag: structural (analysis-limit) flags aren't patchable by repair; the rest are
assert.equal(isFixableFlag('Document exceeded the 600,000-char analysis limit — sections near the end...'), false);
assert.equal(isFixableFlag('3 page(s) not covered by any section: 1–3.'), true);
assert.equal(isFixableFlag('"Foo" has a very short summary (5 words).'), true);

console.log('pageIndex self-check passed');
