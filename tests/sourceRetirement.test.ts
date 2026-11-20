import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RETIRE_AFTER_FAILURES,
  activeSources,
  applyFeedFailures,
  recordFailure,
  recordSuccess,
  resumeFeed,
  type RetirableSource,
} from '../lib/sourceRetirement.ts';

const source = (title: string, extra: Record<string, unknown> = {}): RetirableSource & { consecutiveFailures: number } => ({
  title,
  feedUrl: `https://${title.toLowerCase()}.example/feed`,
  consecutiveFailures: 0,
  ...extra,
});

test('a first failure counts but does not pause', () => {
  assert.deepEqual(recordFailure(undefined), { consecutiveFailures: 1, paused: false });
});

test('a feed is paused on the run that reaches the threshold', () => {
  let state = recordFailure(undefined);
  for (let run = 2; run < RETIRE_AFTER_FAILURES; run += 1) {
    state = recordFailure(state);
  }
  assert.equal(state.paused, false);
  const atThreshold = recordFailure(state);
  assert.equal(atThreshold.paused, true);
  assert.equal(atThreshold.consecutiveFailures, RETIRE_AFTER_FAILURES);
});

test('a feed that answers again starts over', () => {
  assert.deepEqual(recordSuccess(), { consecutiveFailures: 0, paused: false });
  assert.deepEqual(resumeFeed(), { consecutiveFailures: 0, paused: false });
});

test('only the feeds named in the report are counted, by address or by name', () => {
  const sources = [source('Alpha'), source('Beta'), source('Gamma')];
  const next = applyFeedFailures(sources, [{ feedUrl: 'https://beta.example/feed', reason: 'Timed out' }]);
  assert.equal(next[0], sources[0]);
  assert.equal(next[1].consecutiveFailures, 1);
  assert.equal(next[2], sources[2]);
});

test('a quiet digest leaves the sources list untouched', () => {
  const sources = [source('Alpha')];
  assert.equal(applyFeedFailures(sources, []), sources);
});

test('crossing the threshold pauses the feed and says why', () => {
  let sources = [source('Alpha', { consecutiveFailures: RETIRE_AFTER_FAILURES - 1 })];
  sources = applyFeedFailures(sources, [{ title: 'Alpha' }]);
  assert.equal(sources[0].paused, true);
  assert.match(String(sources[0].pausedReason), /failed reads in a row/);
});

test('a paused feed keeps its place in the library but leaves the request', () => {
  const sources = [source('Alpha', { paused: true }), source('Beta')];
  assert.deepEqual(activeSources(sources).map(s => s.title), ['Beta']);
});
