import test from 'node:test';
import assert from 'node:assert/strict';

import { storyIdFor } from '../lib/storyId.ts';
import {
  DIGEST_CACHE_KEY,
  EDITIONS_KEY,
  SAVED_ARTICLES_KEY,
  SEMANTIC_FEEDBACK_KEY,
} from '../lib/storyIdMigration.ts';
import { migrateStoredMarkdown } from '../lib/markdownMigration.ts';

const LINK = 'https://example.com/2026/piece/';
const RAW_TITLE = '**The Quiet** Case for `Slow` Mornings';
const CLEAN_TITLE = 'The Quiet Case for Slow Mornings';
const RAW_SUMMARY = 'Essays on [markets](https://example.com) and *growth*.';
const CLEAN_SUMMARY = 'Essays on markets and growth.';

const story = (overrides = {}) => ({
  id: storyIdFor(LINK, RAW_TITLE),
  url: LINK,
  title: RAW_TITLE,
  summary: RAW_SUMMARY,
  source: 'A publication',
  sourceDescription: 'Recent content on *economics*.',
  ...overrides,
});

test('stored stories read as the words their screens already show', () => {
  const migrated = migrateStoredMarkdown({
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [story()] }),
    [EDITIONS_KEY]: JSON.stringify([{ curatedAt: 900, items: [story()] }]),
    [SAVED_ARTICLES_KEY]: JSON.stringify([story()]),
  });
  assert.equal(migrated.changed, true);
  for (const key of [DIGEST_CACHE_KEY, EDITIONS_KEY, SAVED_ARTICLES_KEY]) {
    const items = key === EDITIONS_KEY
      ? JSON.parse(migrated.data[key])[0].items
      : key === DIGEST_CACHE_KEY
        ? JSON.parse(migrated.data[key]).items
        : JSON.parse(migrated.data[key]);
    assert.equal(items[0].title, CLEAN_TITLE);
    assert.equal(items[0].summary, CLEAN_SUMMARY);
    assert.equal(items[0].sourceDescription, 'Recent content on economics.');
  }
});

test('cleaning a headline never moves the story', () => {
  const before = story();
  const migrated = migrateStoredMarkdown({
    [SAVED_ARTICLES_KEY]: JSON.stringify([before]),
  });
  const after = JSON.parse(migrated.data[SAVED_ARTICLES_KEY])[0];
  assert.equal(after.id, before.id, 'the link still names the story');
  assert.equal(after.id, storyIdFor(LINK, after.title));
});

test('a story with no link keeps the headline its id is hashed from', () => {
  const linkless = story({ id: storyIdFor('', RAW_TITLE), url: '' });
  const migrated = migrateStoredMarkdown({
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [linkless] }),
  });
  const after = JSON.parse(migrated.data[DIGEST_CACHE_KEY]).items[0];
  assert.equal(after.title, RAW_TITLE, 'the id would no longer name it');
  assert.equal(after.summary, CLEAN_SUMMARY, 'the excerpt names nothing and is still cleaned');
});

test('a vote the new scheme names has its recorded words cleaned, old ids are untouched', () => {
  const named = {
    id: storyIdFor(LINK, RAW_TITLE),
    vote: 'like',
    title: RAW_TITLE,
    text: `${RAW_TITLE} — the body the ranking learns from`,
    timestamp: 100,
  };
  const legacy = { ...named, id: 'live_aHR0cHM6Ly9hcnN0' };
  const migrated = migrateStoredMarkdown({ [SEMANTIC_FEEDBACK_KEY]: JSON.stringify([named, legacy]) });
  assert.equal(migrated.changed, true);
  const [afterNamed, afterLegacy] = JSON.parse(migrated.data[SEMANTIC_FEEDBACK_KEY]);
  assert.equal(afterNamed.title, CLEAN_TITLE);
  assert.ok(!afterNamed.text.includes('**'));
  assert.deepEqual(afterLegacy, legacy);
});

test('feed blurbs are cleaned and clean libraries are left alone', () => {
  const migrated = migrateStoredMarkdown({
    curator_sources: JSON.stringify([{ id: 's1', description: 'Recent content on *economics*.' }]),
  });
  assert.equal(migrated.changed, true);
  assert.equal(JSON.parse(migrated.data.curator_sources)[0].description, 'Recent content on economics.');

  const clean = {
    [SAVED_ARTICLES_KEY]: JSON.stringify([story({ title: CLEAN_TITLE, summary: CLEAN_SUMMARY, sourceDescription: 'Recent content on economics.' })]),
    curator_sources: '[{"id":"s1"}]',
  };
  const untouched = migrateStoredMarkdown(clean);
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.data, clean);
});

test('a second pass changes nothing and broken values do not throw', () => {
  const once = migrateStoredMarkdown({
    [DIGEST_CACHE_KEY]: JSON.stringify({ curatedAt: 1000, items: [story(), 'junk', null] }),
    [EDITIONS_KEY]: 'not json',
    [SAVED_ARTICLES_KEY]: JSON.stringify([story()]),
  });
  const twice = migrateStoredMarkdown(once.data);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.data, once.data);
});
