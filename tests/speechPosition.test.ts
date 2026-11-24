// Listening position is what makes a reopened piece continue where it stopped. It is read from
// storage that an older build wrote, so the malformed cases matter as much as the happy path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEECH_POSITION_LIMIT,
  forgetSpeechPosition,
  nextUnreadPieces,
  readSpeechPositions,
  rememberSpeechPosition,
  resumeSpeechIndex,
} from '../lib/readAloud.ts';

test('a stored map is read back, and anything malformed is dropped', () => {
  const raw = JSON.stringify({
    a: { index: 4, total: 40, paragraph: 2, at: 1 },
    // A queue length below the index cannot be resumed
    b: { index: 9, total: 3, paragraph: 0, at: 1 },
    c: { index: 'x', total: 10, paragraph: 0, at: 1 },
    d: { index: 1, total: 10, paragraph: -2, at: 1 },
    e: null,
  });
  const positions = readSpeechPositions(raw);
  assert.deepEqual(Object.keys(positions), ['a']);
  assert.deepEqual(positions.a, { index: 4, total: 40, paragraph: 2, at: 1 });

  assert.deepEqual(readSpeechPositions('not json'), {});
  assert.deepEqual(readSpeechPositions('[]'), {});
  assert.deepEqual(readSpeechPositions(null), {});
});

test('the place for a piece replaces its previous one and nothing else', () => {
  let positions = rememberSpeechPosition({}, 'piece', { index: 3, total: 20, paragraph: 1, at: 10 });
  positions = rememberSpeechPosition(positions, 'other', { index: 0, total: 5, paragraph: -1, at: 20 });
  positions = rememberSpeechPosition(positions, 'piece', { index: 7, total: 20, paragraph: 3, at: 30 });

  assert.equal(Object.keys(positions).length, 2);
  assert.deepEqual(positions.piece, { index: 7, total: 20, paragraph: 3, at: 30 });
  // An impossible place is ignored rather than stored
  assert.deepEqual(rememberSpeechPosition(positions, 'piece', { index: 99, total: 20, paragraph: 0, at: 40 }), positions);
});

test('the map keeps the pieces listened to most recently', () => {
  let positions = {};
  for (let i = 0; i < SPEECH_POSITION_LIMIT + 5; i += 1) {
    positions = rememberSpeechPosition(positions, `piece-${i}`, { index: 1, total: 5, paragraph: 0, at: i });
  }
  const ids = Object.keys(positions);
  assert.equal(ids.length, SPEECH_POSITION_LIMIT);
  assert.ok(ids.includes(`piece-${SPEECH_POSITION_LIMIT + 4}`), 'the newest is kept');
  assert.ok(!ids.includes('piece-0'), 'the oldest is dropped');
});

test('a finished piece forgets its place', () => {
  const positions = rememberSpeechPosition({}, 'piece', { index: 4, total: 20, paragraph: 2, at: 10 });
  assert.deepEqual(forgetSpeechPosition(positions, 'piece'), {});
  // Forgetting a piece that has no place changes nothing
  assert.equal(forgetSpeechPosition(positions, 'absent'), positions);
});

test('a finished piece hands over to what follows it, then to what came before', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(nextUnreadPieces(ids, 'b', () => false), ['c', 'd', 'a']);
  // A run started at the end still covers the rest of the edition
  assert.deepEqual(nextUnreadPieces(ids, 'd', () => false), ['a', 'b', 'c']);
  // Finished pieces are skipped rather than read again
  assert.deepEqual(nextUnreadPieces(ids, 'b', id => id === 'c' || id === 'a'), ['d']);
});

test('nothing unread left ends the run instead of handing over', () => {
  const ids = ['a', 'b'];
  assert.deepEqual(nextUnreadPieces(ids, 'a', () => true), []);
  // A piece that is not part of the edition has nothing to follow it either
  assert.deepEqual(nextUnreadPieces(ids, 'not-in-the-edition', () => false), []);
  assert.deepEqual(nextUnreadPieces([], 'a', () => false), []);
});

test('listening resumes at the stored sentence only while the queue still matches', () => {
  const positions = rememberSpeechPosition({}, 'piece', { index: 6, total: 20, paragraph: 3, at: 10 });
  assert.equal(resumeSpeechIndex(positions, 'piece', 20), 6);
  // The text changed: a queue of another length starts at the top
  assert.equal(resumeSpeechIndex(positions, 'piece', 21), 0);
  // Unknown piece, or a place at the top, needs no resume
  assert.equal(resumeSpeechIndex(positions, 'absent', 20), 0);
  assert.equal(resumeSpeechIndex(rememberSpeechPosition({}, 'p', { index: 0, total: 20, paragraph: -1, at: 1 }), 'p', 20), 0);
});
