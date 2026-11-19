import test from 'node:test';
import assert from 'node:assert/strict';

import { explainFeedFailure } from '../lib/feedHealth.ts';

test('a missing feed page is treated as a dead site', () => {
  const failure = explainFeedFailure('Feed responded with 404');
  assert.equal(failure.kind, 'gone');
  assert.equal(failure.likelyDead, true);
  assert.match(failure.summary, /no longer exists/i);
});

test('an unclaimed Substack page is treated as a dead site', () => {
  const failure = explainFeedFailure('Not Found. The page you are attempting to access is not found. If you want to claim this URL you can start a Substack today');
  assert.equal(failure.kind, 'gone');
  assert.equal(failure.likelyDead, true);
});

test('a blocked site is explained without suggesting deletion', () => {
  const failure = explainFeedFailure('Feed responded with 403');
  assert.equal(failure.kind, 'blocked');
  assert.equal(failure.likelyDead, false);
  assert.match(failure.summary, /refuses automated readers/i);
});

test('a timeout is treated as passing trouble', () => {
  const failure = explainFeedFailure('Network error while refreshing this feed.');
  assert.equal(failure.kind, 'temporary');
  assert.equal(failure.likelyDead, false);
  assert.match(failure.suggestion, /again later/i);
});

test('an empty feed is called inactive and may be deleted', () => {
  const failure = explainFeedFailure('This feed returned no articles.');
  assert.equal(failure.kind, 'inactive');
  assert.equal(failure.likelyDead, true);
});

test('a malformed address may be deleted', () => {
  const failure = explainFeedFailure('Invalid feed URL format');
  assert.equal(failure.kind, 'invalid');
  assert.equal(failure.likelyDead, true);
});

test('an unrecognised reason is repeated rather than guessed at', () => {
  const failure = explainFeedFailure('Something odd happened upstream');
  assert.equal(failure.kind, 'unknown');
  assert.equal(failure.summary, 'Something odd happened upstream');
  assert.equal(failure.likelyDead, false);
});

test('no reason at all still reads plainly', () => {
  const failure = explainFeedFailure(undefined);
  assert.equal(failure.kind, 'temporary');
  assert.equal(failure.likelyDead, false);
});
