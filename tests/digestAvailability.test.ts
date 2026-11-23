import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReadableDigest } from '../lib/digestAvailability.ts';

interface Item {
  id: string;
  source: string;
  articleUnavailable?: boolean;
}

const enrich = async (items: Item[]): Promise<Item[]> => items.map(item =>
  item.id.startsWith('empty') ? { ...item, articleUnavailable: true } : item,
);

test('unreadable selected stories are removed and replaced from the ranked pool', async () => {
  const selected: Item[] = [
    { id: 'empty-selected', source: 'A' },
    { id: 'readable-selected', source: 'A' },
  ];
  const ranked: Item[] = [
    ...selected,
    { id: 'replacement', source: 'B' },
  ];

  const digest = await buildReadableDigest(selected, ranked, 2, 2, enrich);

  assert.deepEqual(digest.map(item => item.id), ['readable-selected', 'replacement']);
  assert.ok(digest.every(item => !item.articleUnavailable));
});

test('backfill respects the source cap first and relaxes it only when needed', async () => {
  const selected: Item[] = [{ id: 'first', source: 'A' }];
  const ranked: Item[] = [
    ...selected,
    { id: 'second', source: 'A' },
    { id: 'third', source: 'B' },
  ];

  const digest = await buildReadableDigest(selected, ranked, 3, 1, enrich);

  assert.deepEqual(digest.map(item => item.id), ['first', 'third', 'second']);
});

test('returns fewer than requested when every remaining story has no content', async () => {
  const selected: Item[] = [{ id: 'empty-selected', source: 'A' }];
  const ranked: Item[] = [
    ...selected,
    { id: 'empty-alternative', source: 'B' },
  ];

  const digest = await buildReadableDigest(selected, ranked, 2, 2, enrich);

  assert.deepEqual(digest, []);
});

test('enriches large candidate sets in bounded batches and continues after failures', async () => {
  const batchSizes: number[] = [];
  const candidates: Item[] = [
    { id: 'empty-selected', source: 'A' },
    ...Array.from({ length: 7 }, (_, index) => ({ id: `empty-${index}`, source: `S${index}` })),
    { id: 'readable-last', source: 'Last' },
  ];
  const digest = await buildReadableDigest(
    [candidates[0]],
    candidates,
    1,
    1,
    async items => {
      batchSizes.push(items.length);
      return enrich(items);
    },
  );

  assert.deepEqual(digest.map(item => item.id), ['readable-last']);
  assert.ok(batchSizes.every(size => size <= 6));
  assert.ok(batchSizes.length > 1);
});
