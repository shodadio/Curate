import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBuildStamp, isNewerBuild, normalizeNote, parseBuildStamp } from '../lib/buildStamp.ts';

const REPO = 'shodadio/Curate';
const BUILT_AT = '2026-11-20T07:23:00.000Z';
const MAIN_COMMIT = '0123456789abcdef0123456789abcdef01234567';

const build = (patch: Partial<{ commit: string; buildId: string; builtAt: string; repo: string; note: string }> = {}) => ({
  commit: '',
  buildId: '',
  builtAt: BUILT_AT,
  repo: REPO,
  ...patch,
});

test('the visible stamp identifies a real source commit', () => {
  assert.equal(formatBuildStamp(build({ commit: MAIN_COMMIT, buildId: '0123456' })), 'Build · 0123456');
});

test('a source snapshot is not presented as a Git commit', () => {
  assert.equal(formatBuildStamp(build({ buildId: '7654321' })), 'Source snapshot · 7654321');
  assert.equal(formatBuildStamp(build()), 'Build identity unavailable');
});

test('a later server build is offered as an update', () => {
  assert.equal(isNewerBuild(
    build({ commit: '1111111' }),
    build({ commit: '2222222', builtAt: '2026-11-20T08:00:00.000Z' }),
  ), true);
});

test('the build this device already runs is not an update', () => {
  assert.equal(isNewerBuild(
    build({ commit: '1111111' }),
    build({ commit: '1111111' }),
  ), false);
});

test('an older server build is not an update, even with a different commit', () => {
  assert.equal(isNewerBuild(
    build({ commit: '2222222', builtAt: '2026-11-20T08:00:00.000Z' }),
    build({ commit: '1111111' }),
  ), false);
});

test('without build times, a different known build identity counts as newer', () => {
  assert.equal(isNewerBuild(build({ commit: '1111111', builtAt: '' }), build({ commit: '2222222', builtAt: '' })), true);
  assert.equal(isNewerBuild(build({ buildId: '1111111', builtAt: '' }), build({ buildId: '2222222', builtAt: '' })), true);
  assert.equal(isNewerBuild(build({ commit: '', buildId: '', builtAt: '' }), build({ buildId: '2222222', builtAt: '' })), false);
});

test('server build metadata is parsed without a GitHub verification result', () => {
  assert.deepEqual(
    parseBuildStamp({
      commit: ` ${MAIN_COMMIT.toUpperCase()} `,
      buildId: '0123456',
      builtAt: BUILT_AT,
      repo: REPO,
      note: 'Faster digest\nand fewer jumps',
    }),
    {
      commit: MAIN_COMMIT.toUpperCase(),
      buildId: '0123456',
      builtAt: BUILT_AT,
      repo: REPO,
      note: 'Faster digest and fewer jumps',
    },
  );
});

test('snapshot metadata remains distinct from a commit', () => {
  assert.deepEqual(parseBuildStamp({ buildId: '7654321', builtAt: BUILT_AT, repo: REPO }), {
    commit: '',
    buildId: '7654321',
    builtAt: BUILT_AT,
    repo: REPO,
    note: '',
  });
});

test('a report without build identity is not usable', () => {
  assert.equal(parseBuildStamp(null), null);
  assert.equal(parseBuildStamp('<html></html>'), null);
  assert.equal(parseBuildStamp([]), null);
  assert.equal(parseBuildStamp({}), null);
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
    build({ commit: '1111111', note: 'old wording' }),
    build({ commit: '1111111', note: 'new wording' }),
  ), false);
});
