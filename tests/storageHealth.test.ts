import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, measureStorage, pruneArticleBodies } from '../lib/storageHealth.ts';

test('the report ranks what is stored by size and ignores other apps', () => {
  const report = measureStorage({
    curator_sources: 'a'.repeat(100),
    curator_saved_articles: 'b'.repeat(500),
    'other_app': 'c'.repeat(999),
  });
  assert.deepEqual(report.entries.map(entry => entry.key), ['curator_saved_articles', 'curator_sources']);
  assert.equal(report.entries[0].label, 'Saved article bodies');
  assert.equal(report.totalBytes, 600);
});

test('sizes are reported the way a reader reads them', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 MB');
});

test('pruning drops old bodies and keeps the newest few for offline reading', () => {
  const items = [
    { id: 'old', fullText: 'x'.repeat(100), publishedAt: '2026-11-01T00:00:00Z' },
    { id: 'new', fullText: 'y'.repeat(50), publishedAt: '2026-11-19T00:00:00Z' },
    { id: 'none' },
  ];
  const result = pruneArticleBodies(items, 1);
  assert.equal(result.prunedCount, 1);
  assert.equal(result.freedBytes, 100);
  assert.equal(result.items[0].fullText, undefined);
  assert.equal(result.items[1].fullText, 'y'.repeat(50));
});

test('pruning keeps the headline and summary of a piece whose body it drops', () => {
  const result = pruneArticleBodies([{ id: 'a', title: 'Title', summary: 'Summary', fullText: 'body' }], 0);
  assert.deepEqual(result.items[0], { id: 'a', title: 'Title', summary: 'Summary' });
});

test('an empty library prunes to nothing rather than throwing', () => {
  assert.deepEqual(pruneArticleBodies([], 5), { items: [], prunedCount: 0, freedBytes: 0 });
});
