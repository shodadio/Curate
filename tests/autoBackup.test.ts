import test from 'node:test';
import assert from 'node:assert/strict';

import { readBackupFile } from '../lib/backup.ts';
import { backupPermission, writeBackupFile, type AutoBackupHandle } from '../src/autoBackup.ts';

// A stand-in for the file handle the browser hands back, recording what was written.
const fakeHandle = () => {
  let written = '';
  let closed = false;
  const handle: AutoBackupHandle = {
    name: 'curator-backup.json',
    async createWritable() {
      return {
        async write(chunk: string) { written += chunk; },
        async close() { closed = true; },
      };
    },
  };
  return { handle, text: () => written, closed: () => closed };
};

test('an automatic backup is a file Restore from a backup can read', async () => {
  const file = fakeHandle();
  const result = await writeBackupFile(
    file.handle,
    { curator_saved_ids: '["a"]', curator_reader_theme: 'dark' },
    new Date('2026-11-28T09:00:00.000Z'),
  );

  assert.equal(result.ok, true);
  assert.equal(file.closed(), true);

  const read = readBackupFile(file.text());
  assert.equal(read.ok, true);
  assert.deepEqual(read.ok && read.data, {
    curator_saved_ids: '["a"]',
    curator_reader_theme: 'dark',
  });
  assert.equal(read.ok && read.exportedAt, Date.parse('2026-11-28T09:00:00.000Z'));
});

test('an empty library never overwrites a good backup file', async () => {
  const file = fakeHandle();
  const result = await writeBackupFile(file.handle, {});

  assert.equal(result.ok, false);
  assert.equal(file.text(), '');
});

test('a refused write is reported instead of thrown', async () => {
  const handle: AutoBackupHandle = {
    name: 'curator-backup.json',
    async createWritable() {
      throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    },
  };

  const result = await writeBackupFile(handle, { curator_sources: '[]' });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /Reconnect/);
});

test('a handle without permission methods is treated as writable', async () => {
  const { handle } = fakeHandle();
  assert.equal(await backupPermission(handle), 'granted');
});
