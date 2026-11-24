import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBuildStamp, isNewerBuild, normalizeNote } from '../lib/buildStamp.ts';

const REPO = 'shodadio/Curate';
const BUILT_AT = '2026-11-20T07:23:00.000Z';

test('names the repository, commit and build time', () => {
  const stamp = formatBuildStamp({ commit: 'abc1234', builtAt: BUILT_AT, repo: REPO });
  assert.ok(stamp.startsWith(`${REPO} · Build abc1234 · `), stamp);
  assert.match(stamp, /2026/);
});

test('a build without a commit still names a version', () => {
  assert.equal(
    formatBuildStamp({ commit: '', builtAt: BUILT_AT, repo: REPO }),
    `${REPO} · Build 2026.11.20-0723`,
  );
});

test('the generated version is in UTC, not the machine timezone', () => {
  const stamp = formatBuildStamp({ commit: '', builtAt: '2026-11-20T23:59:00.000Z', repo: REPO });
  assert.ok(stamp.endsWith('2026.11.20-2359'), stamp);
});

test('a missing repository still starts with the version', () => {
  const stamp = formatBuildStamp({ commit: 'abc1234', builtAt: BUILT_AT, repo: '' });
  assert.ok(stamp.startsWith('Build abc1234 · '), stamp);
});

test('a missing build time never removes the version', () => {
  assert.equal(formatBuildStamp({ commit: '', builtAt: '', repo: REPO }), `${REPO} · Build unstamped`);
  assert.equal(formatBuildStamp({ commit: 'abc1234', builtAt: 'not a date', repo: REPO }), `${REPO} · Build abc1234`);
});

test('a later server build is offered as an update', () => {
  assert.equal(isNewerBuild(
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO },
    { commit: '2222222', builtAt: '2026-11-20T08:00:00.000Z', repo: REPO },
  ), true);
});

test('the build this device already runs is not an update', () => {
  assert.equal(isNewerBuild(
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO },
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO },
  ), false);
});

test('an older server build is not an update, even with a different commit', () => {
  assert.equal(isNewerBuild(
    { commit: '2222222', builtAt: '2026-11-20T08:00:00.000Z', repo: REPO },
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO },
  ), false);
});

test('without build times, only a different known commit counts', () => {
  assert.equal(isNewerBuild({ commit: '1111111', builtAt: '', repo: REPO }, { commit: '2222222', builtAt: '', repo: REPO }), true);
  assert.equal(isNewerBuild({ commit: '1111111', builtAt: '', repo: REPO }, { commit: '1111111', builtAt: '', repo: REPO }), false);
  assert.equal(isNewerBuild({ commit: '', builtAt: '', repo: REPO }, { commit: '2222222', builtAt: '', repo: REPO }), false);
});

test('a release note is folded to one line', () => {
  assert.equal(normalizeNote('  Faster digest\n\tand fewer  jumps '), 'Faster digest and fewer jumps');
  assert.equal(normalizeNote(''), '');
  assert.equal(normalizeNote(undefined), '');
  assert.equal(normalizeNote(42), '');
});

test('a long release note is cut instead of growing the bar', () => {
  const note = normalizeNote('x'.repeat(400));
  assert.equal(note.length, 120);
  assert.ok(note.endsWith('…'), note);
});

test('the note never decides whether a build is newer', () => {
  assert.equal(isNewerBuild(
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO, note: 'old wording' },
    { commit: '1111111', builtAt: BUILT_AT, repo: REPO, note: 'new wording' },
  ), false);
});

test('blank values are treated as absent', () => {
  assert.equal(
    formatBuildStamp({ commit: '   ', builtAt: BUILT_AT, repo: '   ' }),
    'Build 2026.11.20-0723',
  );
});
