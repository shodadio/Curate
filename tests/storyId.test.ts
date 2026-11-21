import test from 'node:test';
import assert from 'node:assert/strict';

import { backupFile, readBackupFile, restorePlan } from '../lib/backup.ts';
import { STORY_ID_PREFIX, isStoryId, legacyStoryIdFor, storyIdFor } from '../lib/storyId.ts';
import {
  DIGEST_CACHE_KEY,
  DIGEST_HISTORY_KEY,
  EDITIONS_KEY,
  READ_ARTICLES_KEY,
  READING_STATS_KEY,
  SAVED_ARTICLES_KEY,
  SAVED_IDS_KEY,
  migrateStoryIds,
} from '../lib/storyIdMigration.ts';

// What the old scheme produced for every Ars Technica story: base64 of "https://arst".
const OLD_ARS = 'live_aHR0cHM6Ly9hcnN0';
const OLD_STRA = 'live_aHR0cHM6Ly9zdHJh';
const OLD_GONE = 'live_aHR0cHM6Ly9nb25l';

const ARS_A = 'https://arstechnica.com/science/2026/11/a/';
const ARS_B = 'https://arstechnica.com/tech/2026/11/b/';
const STRA = 'https://stratechery.com/2026/down-in-dc/';

const story = (id: string, url: string, title: string) => ({ id, url, title, source: 'A publication' });

test('two stories from one publication get ids of their own', () => {
  const first = storyIdFor(ARS_A, 'A');
  const second = storyIdFor(ARS_B, 'B');
  assert.notEqual(first, second);
  assert.ok(first.startsWith(STORY_ID_PREFIX));
  assert.equal(first, storyIdFor(ARS_A, 'A'), 'the same link is the same story');
  assert.equal(first, storyIdFor(ARS_A, 'A rewritten heading'), 'the link names the story, not the heading');
});

test('the old scheme is reproduced exactly, so old records can be recognised', () => {
  assert.equal(legacyStoryIdFor(ARS_A, 'A'), OLD_ARS);
  assert.equal(legacyStoryIdFor(ARS_B, 'B'), OLD_ARS, 'every story from one publication shared an id');
  assert.equal(legacyStoryIdFor('', ''), '');
});

test('an id from the new scheme is told apart from an old one', () => {
  assert.equal(isStoryId(storyIdFor(ARS_A, 'A')), true);
  assert.equal(isStoryId(OLD_ARS), false);
  assert.equal(isStoryId('live_legacy'), false);
});

test('a story without a link is named by its title', () => {
  assert.notEqual(storyIdFor('', 'One'), storyIdFor('', 'Two'));
  assert.equal(storyIdFor('', 'One'), storyIdFor('', 'One'));
  assert.equal(storyIdFor('', ''), '', 'nothing to name');
});

test('stored ids become per-story and the records follow them', () => {
  const migrated = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({
      curatedAt: 1000,
      items: [story(OLD_ARS, ARS_A, 'A'), story(OLD_STRA, STRA, 'Down in DC')],
    }),
    [EDITIONS_KEY]: JSON.stringify([
      { curatedAt: 900, items: [story(OLD_ARS, ARS_B, 'B')] },
    ]),
    [SAVED_ARTICLES_KEY]: JSON.stringify([story(OLD_ARS, ARS_A, 'A')]),
    [DIGEST_HISTORY_KEY]: JSON.stringify([
      { id: OLD_ARS, shownAt: 10 },
      { id: OLD_STRA, shownAt: 20 },
      { id: OLD_GONE, shownAt: 30 },
    ]),
    [READING_STATS_KEY]: JSON.stringify({
      [OLD_ARS]: { maxDepth: 90, lastRead: 5 },
      [OLD_STRA]: { maxDepth: 40, lastRead: 6 },
    }),
    [READ_ARTICLES_KEY]: JSON.stringify([OLD_ARS]),
    [SAVED_IDS_KEY]: JSON.stringify([OLD_ARS]),
  });

  assert.equal(migrated.changed, true);

  const cached = JSON.parse(migrated.data[DIGEST_CACHE_KEY]).items;
  const kept = JSON.parse(migrated.data[EDITIONS_KEY])[0].items;
  const saved = JSON.parse(migrated.data[SAVED_ARTICLES_KEY]);

  const idA = storyIdFor(ARS_A, 'A');
  const idB = storyIdFor(ARS_B, 'B');
  const idStra = storyIdFor(STRA, 'Down in DC');
  assert.deepEqual(cached.map((item: { id: string }) => item.id), [idA, idStra]);
  assert.deepEqual(kept.map((item: { id: string }) => item.id), [idB], 'a second story from the same publication keeps its own card');
  assert.deepEqual(saved.map((item: { id: string }) => item.id), [idA]);

  // The old id named both Ars stories, so both inherit what was recorded against it. A record
  // whose story is no longer stored keeps its old id rather than being lost.
  assert.deepEqual(
    JSON.parse(migrated.data[DIGEST_HISTORY_KEY]).map((entry: { id: string }) => entry.id).sort(),
    [idA, idB, idStra, OLD_GONE].sort(),
    'shown stories follow their ids, and a story with no entry on file keeps the id it was shown under',
  );
  assert.deepEqual(Object.keys(JSON.parse(migrated.data[READING_STATS_KEY])).sort(), [idA, idB, idStra].sort());
  assert.deepEqual(JSON.parse(migrated.data[READ_ARTICLES_KEY]).sort(), [idA, idB].sort());
  assert.deepEqual(JSON.parse(migrated.data[SAVED_IDS_KEY]).sort(), [idA, idB].sort());
});

test('an id from the new scheme survives even when its story is no longer stored', () => {
  const stored = {
    [READING_STATS_KEY]: JSON.stringify({ live_01ktjpk01u7b02: { maxDepth: 80, lastRead: 5 } }),
  };
  const migrated = migrateStoryIds(stored);
  assert.equal(migrated.changed, false);
  assert.deepEqual(migrated.data, stored);
});

test('a backup written before per-story ids is converted when it is restored', () => {
  const before = backupFile({
    [DIGEST_CACHE_KEY]: JSON.stringify({
      curatedAt: 1000,
      items: [story(OLD_ARS, ARS_A, 'A'), story(OLD_ARS, ARS_B, 'B')],
    }),
    [DIGEST_HISTORY_KEY]: JSON.stringify([{ id: OLD_ARS, shownAt: 10 }]),
    [READING_STATS_KEY]: JSON.stringify({ [OLD_ARS]: { maxDepth: 70, lastRead: 9 } }),
    [SAVED_ARTICLES_KEY]: JSON.stringify([story(OLD_ARS, ARS_A, 'A')]),
  });

  const read = readBackupFile(JSON.stringify(before));
  assert.equal(read.ok, true);
  if (!read.ok) return;

  // What the restore writes: the file's library, converted before it lands in storage.
  const plan = restorePlan({}, migrateStoryIds(read.data).data);
  const restored: Record<string, string> = {};
  plan.write.forEach(entry => { restored[entry.key] = entry.value; });

  const idA = storyIdFor(ARS_A, 'A');
  const idB = storyIdFor(ARS_B, 'B');
  const cached = JSON.parse(restored[DIGEST_CACHE_KEY]).items;
  assert.deepEqual(cached.map((item: { id: string }) => item.id), [idA, idB], 'the restored edition holds two stories, not one publication');
  assert.deepEqual(JSON.parse(restored[SAVED_ARTICLES_KEY]).map((item: { id: string }) => item.id), [idA]);
  assert.deepEqual(
    JSON.parse(restored[DIGEST_HISTORY_KEY]).map((entry: { id: string }) => entry.id).sort(),
    [idA, idB].sort(),
    'the shown record follows both stories the old id named',
  );
  assert.deepEqual(Object.keys(JSON.parse(restored[READING_STATS_KEY])).sort(), [idA, idB].sort());

  // The file on disk is left as it was; only the copy written back is converted.
  assert.deepEqual(read.data, before.data);
});

test('migrating twice changes nothing the second time', () => {
  const once = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [story(OLD_ARS, ARS_A, 'A')] }),
    [DIGEST_HISTORY_KEY]: JSON.stringify([{ id: OLD_ARS, shownAt: 10 }]),
    [READ_ARTICLES_KEY]: JSON.stringify([OLD_ARS]),
  });
  const twice = migrateStoryIds(once.data);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.data, once.data);
});

test('a library with nothing stored is left alone', () => {
  const untouched = migrateStoryIds({ curator_sources: '[{"id":"src_1"}]' });
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.data, { curator_sources: '[{"id":"src_1"}]' });
});

test('a story with neither link nor title keeps the id it was stored with', () => {
  const migrated = migrateStoryIds({
    [SAVED_ARTICLES_KEY]: JSON.stringify([{ id: 'live_legacy', title: '', url: '' }]),
  });
  assert.deepEqual(JSON.parse(migrated.data[SAVED_ARTICLES_KEY]), [{ id: 'live_legacy', title: '', url: '' }]);
});
