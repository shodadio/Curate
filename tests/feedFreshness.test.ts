import test from 'node:test';
import assert from 'node:assert/strict';

import { isPublishedToday, todaysEntries } from '../lib/feedFreshness.ts';

// Local times on purpose: the cutoff is the reader's own midnight.
const at = (iso: string) => new Date(iso).getTime();

test('anything dated since local midnight counts as today', () => {
  const now = at('2026-11-28T15:00:00');
  assert.equal(isPublishedToday({ publishedAtMs: at('2026-11-28T00:00:00') }, now), true);
  assert.equal(isPublishedToday({ publishedAtMs: at('2026-11-28T14:59:00') }, now), true);
});

test('the last minute of yesterday is not today', () => {
  const justAfterMidnight = at('2026-11-28T00:00:30');
  assert.equal(isPublishedToday({ publishedAtMs: at('2026-11-27T23:59:00') }, justAfterMidnight), false);
  assert.equal(isPublishedToday({ publishedAtMs: at('2026-11-28T00:00:10') }, justAfterMidnight), true);
});

test('an undated entry cannot be claimed for today', () => {
  const now = at('2026-11-28T15:00:00');
  assert.equal(isPublishedToday({}, now), false);
  assert.equal(isPublishedToday({ publishedAtMs: NaN }, now), false);
  assert.equal(isPublishedToday({ publishedAtMs: 0 }, now), false);
});

test('tomorrow is not today', () => {
  assert.equal(isPublishedToday({ publishedAtMs: at('2026-11-29T00:00:01') }, at('2026-11-28T15:00:00')), false);
});

test('the narrowed stream keeps its order and drops everything older', () => {
  const now = at('2026-11-28T15:00:00');
  const entries = [
    { id: 'newest', publishedAtMs: at('2026-11-28T14:00:00') },
    { id: 'yesterday', publishedAtMs: at('2026-11-27T09:00:00') },
    { id: 'undated' },
    { id: 'earlier today', publishedAtMs: at('2026-11-28T06:00:00') },
  ];
  assert.deepEqual(todaysEntries(entries, now).map(entry => entry.id), ['newest', 'earlier today']);
});

test('an empty or missing list narrows to nothing rather than failing', () => {
  assert.deepEqual(todaysEntries([], 0), []);
  assert.deepEqual(todaysEntries(undefined as unknown as [], 0), []);
});
