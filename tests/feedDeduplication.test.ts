import test from 'node:test';
import assert from 'node:assert/strict';

import { deduplicateFeedArticles } from '../lib/feedDeduplication.ts';

test('feed stream keeps one copy of a story shared by subscriptions', () => {
  const first = { id: 'story-1', title: 'A post', source: 'Exponential View' };
  const duplicate = { id: 'story-1', title: 'A post', source: 'Exponential View (Substack)' };
  const other = { id: 'story-2', title: 'Another post', source: 'Exponential View' };

  assert.deepEqual(deduplicateFeedArticles([first, duplicate, other]), [first, other]);
});

test('feed stream leaves items without stable ids intact', () => {
  const items = [{ title: 'First' }, { title: 'Second' }];
  assert.deepEqual(deduplicateFeedArticles(items), items);
});
