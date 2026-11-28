import test from 'node:test';
import assert from 'node:assert/strict';

import { deduplicateFeedArticles } from '../lib/feedDeduplication.ts';

test('a story carried by two subscriptions appears once, under the first feed that answered', () => {
  const first = { id: 'live_abc', title: 'A post', source: 'Exponential View' };
  const duplicate = { id: 'live_abc', title: 'A post', source: 'Exponential View (Substack)' };
  const other = { id: 'live_def', title: 'Another post', source: 'Exponential View' };

  assert.deepEqual(deduplicateFeedArticles([first, duplicate, other]), [first, other]);
});

test('different stories from one publication are not merged', () => {
  const a = { id: 'live_aaa', url: 'https://example.com/a', title: 'Same headline' };
  const b = { id: 'live_bbb', url: 'https://example.com/b', title: 'Same headline' };

  assert.deepEqual(deduplicateFeedArticles([a, b]), [a, b]);
});

test('an article with nothing to compare it by is left alone', () => {
  const items = [{ title: 'First' }, { title: 'Second' }, { id: '  ' }];

  assert.deepEqual(deduplicateFeedArticles(items), items);
});
