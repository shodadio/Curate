import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  BUILD_INFO_FILE,
  commitFromEnv,
  noteFromEnv,
  parseBuildInfo,
  readBuildInfo,
  versionReport,
} from '../lib/buildInfo.ts';

const REPO = 'shodadio/Curate';
const BUILT_AT = '2026-11-20T07:23:00.000Z';

test('the live report names the same version Settings shows', () => {
  const report = versionReport({ commit: 'abc1234', builtAt: BUILT_AT, repo: REPO });
  assert.equal(report.version, 'abc1234');
  assert.ok(report.stamp.startsWith(`${REPO} · Build abc1234 · `), report.stamp);
});

test('a build without a commit still reports a version', () => {
  const report = versionReport({ commit: '', builtAt: BUILT_AT, repo: '' });
  assert.equal(report.version, '2026.11.20-0723');
  assert.equal(report.repo, REPO);
  assert.equal(report.stamp, `${REPO} · Build 2026.11.20-0723`);
});

test('the build file is read from the built output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-version-'));
  try {
    assert.equal(readBuildInfo(dir), null);
    fs.writeFileSync(
      path.join(dir, BUILD_INFO_FILE),
      JSON.stringify({ commit: 'abc1234', builtAt: BUILT_AT, repo: REPO }),
    );
    assert.deepEqual(readBuildInfo(dir), { commit: 'abc1234', builtAt: BUILT_AT, repo: REPO, note: '' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a damaged build file falls back instead of crashing', () => {
  assert.equal(parseBuildInfo('not json'), null);
  assert.equal(parseBuildInfo('{}'), null);
  assert.equal(parseBuildInfo('[]'), null);
  assert.deepEqual(parseBuildInfo(JSON.stringify({ commit: ' abc1234 ' })), {
    commit: 'abc1234',
    builtAt: '',
    repo: REPO,
    note: '',
  });
});

test('a release note travels with the build it was made from', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-note-'));
  try {
    fs.writeFileSync(
      path.join(dir, BUILD_INFO_FILE),
      JSON.stringify({ commit: 'abc1234', builtAt: BUILT_AT, repo: REPO, note: 'Faster digest\nand fewer jumps' }),
    );
    const info = readBuildInfo(dir)!;
    assert.equal(info.note, 'Faster digest and fewer jumps');
    assert.equal(versionReport(info).note, 'Faster digest and fewer jumps');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a release without a note reports none', () => {
  assert.equal(versionReport({ commit: 'abc1234', builtAt: BUILT_AT, repo: REPO }).note, '');
  assert.equal(parseBuildInfo(JSON.stringify({ commit: 'abc1234', note: 42 }))?.note, '');
});

test('the note is read from the release variables', () => {
  assert.equal(noteFromEnv({ RELEASE_NOTE: 'Faster digest' }), 'Faster digest');
  assert.equal(noteFromEnv({ BUILD_NOTE: 'Fewer jumps' }), 'Fewer jumps');
  assert.equal(noteFromEnv({}), '');
});

test('the commit is read from the host variables, first one wins', () => {
  assert.equal(commitFromEnv({ SOURCE_COMMIT: 'aaa1111', GITHUB_SHA: 'bbb2222' }), 'aaa1111');
  assert.equal(commitFromEnv({ GITHUB_SHA: 'bbb2222' }), 'bbb2222');
  assert.equal(commitFromEnv({ SOURCE_COMMIT: '   ' }), '');
});
