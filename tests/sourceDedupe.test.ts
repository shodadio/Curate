import test from 'node:test';
import assert from 'node:assert/strict';

import { dedupeSources, normalizeFeedUrl, type DedupeCandidate } from '../lib/sourceDedupe.ts';

const source = (title: string, feedUrl: string, extra: DedupeCandidate = {}): DedupeCandidate => ({
  title,
  feedUrl,
  status: 'active' as const,
  ...extra,
});

const failing = (title: string, feedUrl: string, failingReason: string): DedupeCandidate =>
  source(title, feedUrl, { status: 'failing', failingReason });

test('an address is the same feed whatever its scheme, casing or trailing slash', () => {
  assert.equal(normalizeFeedUrl(' HTTPS://WWW.Example.com/feed/ '), 'example.com/feed');
});

test('one feed added through two spellings of its address is left as one row', () => {
  const sources = [
    source('Example', 'https://example.com/feed'),
    source('Example', 'http://www.example.com/feed/'),
  ];
  const next = dedupeSources(sources);
  assert.equal(next.length, 1);
  assert.equal(next[0].feedUrl, 'https://example.com/feed');
});

test('two dead rows for one publication collapse to the one that still answers', () => {
  const sources = [
    failing('Steven Bartlett', 'https://stevenbartlett.substack.com/feed', 'Feed responded with 404'),
    failing('Steven Bartlett', 'https://steven.substack.com/feed', 'No readable articles in the feed'),
  ];
  const next = dedupeSources(sources);
  assert.equal(next.length, 1);
  assert.equal(next[0].feedUrl, 'https://steven.substack.com/feed');
});

test('a dead namesake is dropped and the working subscription kept', () => {
  const sources = [
    failing('Alpha', 'https://old.alpha.example/feed', 'Feed responded with 404'),
    source('Alpha', 'https://alpha.example/feed'),
  ];
  const next = dedupeSources(sources);
  assert.equal(next.length, 1);
  assert.equal(next[0].feedUrl, 'https://alpha.example/feed');
});

test('two working subscriptions that share a name both stay', () => {
  const sources = [
    source('The Daily', 'https://thedaily.example/feed'),
    source('The Daily', 'https://thedaily.example/podcast.xml'),
  ];
  assert.equal(dedupeSources(sources), sources);
});

test('a namesake that failed temporarily is not dropped by name', () => {
  const sources = [
    source('The Daily', 'https://thedaily.example/feed'),
    failing('The Daily', 'https://thedaily.example/podcast.xml', 'Timed out'),
  ];
  assert.equal(dedupeSources(sources), sources);
});

test('a library with no duplicates is handed back untouched', () => {
  const sources = [source('Alpha', 'https://alpha.example/feed'), source('Beta', 'https://beta.example/feed')];
  assert.equal(dedupeSources(sources), sources);
  assert.deepEqual(dedupeSources([]), []);
  assert.equal(dedupeSources([source('Alpha', 'https://alpha.example/feed')]).length, 1);
});
