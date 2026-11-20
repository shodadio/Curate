import test from 'node:test';
import assert from 'node:assert/strict';

import { MAX_EDITIONS, editionDayLabel, editionItem, editionMinutes, readEditions, recordEdition } from '../lib/editions.ts';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Story ${id}`,
  source: 'Publication',
  folder: 'General',
  summary: 'Summary',
  url: `https://example.com/${id}`,
  readTime: '4 min read',
  ...extra,
});

const at = (iso: string) => Date.parse(iso);

test('an edition keeps only the fields an archive card needs', () => {
  const kept = editionItem({ ...item('a'), fullText: 'x'.repeat(5000), linksCleaned: true, linkRefreshAt: 1 });
  assert.equal('fullText' in kept, false);
  assert.equal('linksCleaned' in kept, false);
  assert.equal(kept.title, 'Story a');
});

test('a later build on the same day replaces that day, not stacks on it', () => {
  const first = recordEdition([], at('2026-11-20T07:00:00Z'), [item('a')]);
  const second = recordEdition(first, at('2026-11-20T18:00:00Z'), [item('b')]);
  assert.equal(second.length, 1);
  assert.equal(second[0].items[0].id, 'b');
});

test('yesterday stays, newest first, and the archive is capped', () => {
  let history: ReturnType<typeof recordEdition> = [];
  for (let day = 1; day <= MAX_EDITIONS + 2; day += 1) {
    history = recordEdition(history, at(`2026-11-${String(day).padStart(2, '0')}T07:00:00Z`), [item(`d${day}`)]);
  }
  assert.equal(history.length, MAX_EDITIONS);
  assert.equal(history[0].items[0].id, `d${MAX_EDITIONS + 2}`);
  assert.ok(history[0].curatedAt > history[1].curatedAt);
});

test('an empty or duplicate run does not create a phantom edition', () => {
  assert.deepEqual(recordEdition([], at('2026-11-20T07:00:00Z'), []), []);
  const stored = recordEdition([], at('2026-11-20T07:00:00Z'), [item('a'), item('a')]);
  assert.equal(stored[0].items.length, 1);
});

test('a damaged archive is dropped rather than breaking the screen', () => {
  assert.deepEqual(readEditions('not json'), []);
  assert.deepEqual(readEditions('{}'), []);
  const partial = readEditions(JSON.stringify([
    { curatedAt: at('2026-11-19T07:00:00Z'), items: [item('a')] },
    { curatedAt: 'nope', items: [item('b')] },
    { curatedAt: at('2026-11-18T07:00:00Z'), items: [] },
  ]));
  assert.equal(partial.length, 1);
  assert.equal(partial[0].items[0].id, 'a');
});

test('the day label names today and yesterday in words', () => {
  const now = at('2026-11-20T12:00:00Z');
  assert.equal(editionDayLabel(at('2026-11-20T07:00:00Z'), now), 'Today');
  assert.equal(editionDayLabel(at('2026-11-19T07:00:00Z'), now), 'Yesterday');
});

test('an edition reports its reading time', () => {
  assert.equal(editionMinutes([{ ...item('a'), readTime: '4 min read' }, { ...item('b'), readTime: '11 min read' }]), 15);
});
