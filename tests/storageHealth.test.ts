import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBytes, measureStorage, pruneArticleBodies, pruneReadingStats } from '../lib/storageHealth.ts';

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

const DAY = 24 * 60 * 60 * 1000;

test('progress older than the recent slice expires, and recent progress stays', () => {
  const now = 100 * DAY;
  const result = pruneReadingStats(
    {
      old: { maxDepth: 80, lastRead: now - 120 * DAY },
      recent: { maxDepth: 40, lastRead: now - 3 * DAY },
    },
    { now },
  );
  assert.deepEqual(Object.keys(result.stats), ['recent']);
  assert.equal(result.droppedCount, 1);
});

test('a story still on screen or saved keeps its progress however old it is', () => {
  const now = 100 * DAY;
  const result = pruneReadingStats(
    {
      onScreen: { maxDepth: 100, finished: true, lastRead: now - 300 * DAY },
      saved: { maxDepth: 60, lastRead: now - 400 * DAY },
      expired: { maxDepth: 20, lastRead: now - 300 * DAY },
    },
    { now, keepIds: ['onScreen', 'saved'] },
  );
  assert.deepEqual(Object.keys(result.stats).sort(), ['onScreen', 'saved']);
});

test('a record with no time survives only while its story is in front of the reader', () => {
  const now = 100 * DAY;
  const result = pruneReadingStats(
    { undatedOnScreen: { maxDepth: 55 }, undated: { maxDepth: 10 } },
    { now, keepIds: ['undatedOnScreen'] },
  );
  assert.deepEqual(Object.keys(result.stats), ['undatedOnScreen'], 'an undated record cannot be placed in the recent slice');
});

test('past the cap the newest records are the ones kept', () => {
  const now = 100 * DAY;
  const result = pruneReadingStats(
    {
      oldest: { lastRead: now - 5 * DAY },
      older: { lastRead: now - 4 * DAY },
      middle: { lastRead: now - 3 * DAY },
      newer: { lastRead: now - 2 * DAY },
      newest: { lastRead: now - DAY },
    },
    { now, maxEntries: 3 },
  );
  assert.deepEqual(Object.keys(result.stats).sort(), ['middle', 'newer', 'newest']);
  assert.equal(result.droppedCount, 2);
});

test('a profile already inside the slice comes back exactly as it went in', () => {
  const now = 100 * DAY;
  const stored = {
    a: { maxDepth: 100, finished: true, lastRead: now - DAY },
    b: { maxDepth: 30, lastRead: now - 2 * DAY },
  };
  const result = pruneReadingStats(stored, { now });
  assert.deepEqual(result.stats, stored);
  assert.equal(result.droppedCount, 0);
  assert.deepEqual(pruneReadingStats(result.stats, { now }).stats, stored, 'pruning again changes nothing');
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
