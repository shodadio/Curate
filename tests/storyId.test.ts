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
  SEMANTIC_FEEDBACK_KEY,
  SIGNALS_KEY,
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

const vote = (id: string, title: string, choice: 'like' | 'dislike' = 'like') => ({
  id,
  vote: choice,
  title,
  text: `${title} — the body the ranking learns from`,
  timestamp: 100,
});

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

test('a vote is moved onto the story whose title it carries', () => {
  const migrated = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({
      curatedAt: 1000,
      items: [story(OLD_ARS, ARS_A, 'A'), story(OLD_ARS, ARS_B, 'B')],
    }),
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([
      vote(OLD_ARS, 'B', 'like'),
      vote(OLD_GONE, 'A story that is no longer on file', 'dislike'),
    ]),
    [SIGNALS_KEY]: JSON.stringify({ moreIds: [OLD_ARS], lessIds: [OLD_GONE], moreTopics: [] }),
  });

  assert.equal(migrated.changed, true);
  const votes = JSON.parse(migrated.data[SEMANTIC_FEEDBACK_KEY]);
  assert.equal(votes[0].id, storyIdFor(ARS_B, 'B'), 'the like now boosts the story it was cast on');
  assert.equal(votes[0].vote, 'like');
  assert.equal(votes[1].id, '', 'a vote with no story on file names nothing');
  assert.equal(votes[1].vote, 'dislike', 'its words still teach the ranking');
  assert.equal(votes[1].text, 'A story that is no longer on file — the body the ranking learns from');

  const signals = JSON.parse(migrated.data[SIGNALS_KEY]);
  assert.deepEqual(signals.moreIds, [storyIdFor(ARS_B, 'B')], 'the vote list follows the story too');
  assert.deepEqual(signals.lessIds, [], 'an id no vote accounts for stops naming a publication');
  assert.deepEqual(signals.moreTopics, []);
});

test('a vote is re-pointed even when the library was converted before the vote was', () => {
  const idA = storyIdFor(ARS_A, 'A');
  const idB = storyIdFor(ARS_B, 'B');
  // A library converted by the first release no longer stores the old id, so the publication
  // has to be recognised from the story's link instead.
  const migrated = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({
      curatedAt: 1000,
      items: [story(idA, ARS_A, 'A'), story(idB, ARS_B, 'B')],
    }),
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([vote(OLD_ARS, 'B')]),
    [SIGNALS_KEY]: JSON.stringify({ moreIds: [OLD_ARS], lessIds: [] }),
  });

  assert.equal(JSON.parse(migrated.data[SEMANTIC_FEEDBACK_KEY])[0].id, idB);
  assert.deepEqual(JSON.parse(migrated.data[SIGNALS_KEY]).moreIds, [idB]);
});

test('a vote is not moved to another publication that ran the same title', () => {
  const migrated = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({
      curatedAt: 1000,
      items: [story(OLD_ARS, ARS_A, 'Weekly Roundup'), story(OLD_STRA, STRA, 'Weekly Roundup')],
    }),
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([
      vote(OLD_ARS, 'Weekly Roundup', 'like'),
      vote(OLD_GONE, 'Weekly Roundup', 'dislike'),
    ]),
    [SIGNALS_KEY]: JSON.stringify({ moreIds: [OLD_ARS], lessIds: [OLD_GONE] }),
  });

  const votes = JSON.parse(migrated.data[SEMANTIC_FEEDBACK_KEY]);
  assert.equal(votes[0].id, storyIdFor(ARS_A, 'Weekly Roundup'), 'the old id says which publication meant it');
  assert.equal(votes[1].id, '', 'a title shared with another publication does not re-point a vote');
});

test('a vote already on a story id, and a vote that names nothing, are left alone', () => {
  const already = storyIdFor(ARS_A, 'A');
  const stored = {
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [story(already, ARS_A, 'A')] }),
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([vote(already, 'A'), vote('', '')]),
  };
  const migrated = migrateStoryIds(stored);
  assert.equal(migrated.changed, false);
  assert.deepEqual(migrated.data, stored);
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
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([vote(OLD_ARS, 'B', 'like')]),
    [SIGNALS_KEY]: JSON.stringify({ moreIds: [OLD_ARS], lessIds: [] }),
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
  assert.equal(JSON.parse(restored[SEMANTIC_FEEDBACK_KEY])[0].id, idB, 'the restored vote names its story');
  assert.deepEqual(JSON.parse(restored[SIGNALS_KEY]).moreIds, [idB]);

  // The file on disk is left as it was; only the copy written back is converted.
  assert.deepEqual(read.data, before.data);
});

test('migrating twice changes nothing the second time', () => {
  const once = migrateStoryIds({
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [story(OLD_ARS, ARS_A, 'A')] }),
    [DIGEST_HISTORY_KEY]: JSON.stringify([{ id: OLD_ARS, shownAt: 10 }]),
    [READ_ARTICLES_KEY]: JSON.stringify([OLD_ARS]),
    [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([vote(OLD_ARS, 'A'), vote(OLD_GONE, 'Gone')]),
    [SIGNALS_KEY]: JSON.stringify({ moreIds: [OLD_ARS, OLD_GONE], lessIds: [] }),
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
