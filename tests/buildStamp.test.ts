import test from 'node:test';
import assert from 'node:assert/strict';

import { formatBuildStamp } from '../lib/buildStamp.ts';

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

test('blank values are treated as absent', () => {
  assert.equal(
    formatBuildStamp({ commit: '   ', builtAt: BUILT_AT, repo: '   ' }),
    'Build 2026.11.20-0723',
  );
});
