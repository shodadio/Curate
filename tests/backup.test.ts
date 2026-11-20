import test from 'node:test';
import assert from 'node:assert/strict';

import { BACKUP_VERSION, backupFile, readBackupFile, restorePlan } from '../lib/backup.ts';

const backupText = (data: Record<string, string>, version: number = BACKUP_VERSION) =>
  JSON.stringify({ app: 'curator', version, exportedAt: '2026-11-20T08:00:00.000Z', data });

test('a backup this build wrote reads back exactly', () => {
  const read = readBackupFile(backupText({ curator_saved_ids: '["a"]', curator_sources: '[]' }));
  assert.equal(read.ok, true);
  assert.deepEqual(read.ok && read.data, { curator_saved_ids: '["a"]', curator_sources: '[]' });
  assert.equal(read.ok && read.exportedAt, Date.parse('2026-11-20T08:00:00.000Z'));
});

test('the exported file names the app and version that wrote it', () => {
  const file = backupFile({ curator_saved_ids: '[]' }, new Date('2026-11-20T08:00:00.000Z'));
  assert.equal(file.app, 'curator');
  assert.equal(file.version, BACKUP_VERSION);
  assert.equal(file.exportedAt, '2026-11-20T08:00:00.000Z');
});

test('a file from another app is refused', () => {
  const read = readBackupFile(JSON.stringify({ app: 'something-else', version: 1, data: { curator_saved_ids: '[]' } }));
  assert.equal(read.ok, false);
});

test('a file that is not JSON is refused rather than throwing', () => {
  assert.equal(readBackupFile('not json').ok, false);
  assert.equal(readBackupFile('[]').ok, false);
  assert.equal(readBackupFile('null').ok, false);
});

test('a backup from a newer build is refused instead of half-read', () => {
  const read = readBackupFile(backupText({ curator_saved_ids: '[]' }, BACKUP_VERSION + 1));
  assert.equal(read.ok, false);
  assert.match(read.ok === false ? read.error : '', /newer version/);
});

test('a damaged value refuses the whole file', () => {
  const read = readBackupFile(JSON.stringify({ app: 'curator', version: 1, data: { curator_saved_ids: 42 } }));
  assert.equal(read.ok, false);
});

test('keys that are not Curator data are ignored, and an empty library is refused', () => {
  const read = readBackupFile(JSON.stringify({ app: 'curator', version: 1, data: { 'other_app': 'x', 'curator_sources': '[]' } }));
  assert.deepEqual(read.ok && read.data, { curator_sources: '[]' });
  assert.equal(readBackupFile(JSON.stringify({ app: 'curator', version: 1, data: { other: 'x' } })).ok, false);
});

test('restoring replaces the stored library rather than merging into it', () => {
  const plan = restorePlan(
    { curator_saved_ids: '["old"]', curator_sources: '["old"]', curator_reader_theme: 'dark', stray: 'x' },
    { curator_saved_ids: '["new"]' },
  );
  assert.deepEqual(plan.write, [{ key: 'curator_saved_ids', value: '["new"]' }]);
  assert.deepEqual(plan.remove.sort(), ['curator_reader_theme', 'curator_sources']);
});
