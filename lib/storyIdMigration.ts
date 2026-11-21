// The first id scheme hashed only the opening characters of a link, so every story from one
// publication shared an id. This carries what the browser stored under those ids onto ids of
// the reader's own stories.
//
// An old id cannot say which of a publication's stories it meant. Every story still on file
// under that id inherits the record — the whole point is that an already-read story cannot come
// back, and hiding the other stories the archive remembers from that publication is a one-time
// cost paid for it. An old id with no story on file is dropped: its story is beyond the
// 24-hour window an edition draws from, so no build could hand it back.
//
// A vote is different. It holds the title of the one story it was cast on, so it is moved to
// that story when the story is still on file, and its words are kept without an id when it is
// not: the ranking can still learn from them, but no record keeps naming a publication.

import { isStoryId, legacyStoryIdFor, storyIdFor } from './storyId';

export const DIGEST_CACHE_KEY = 'curator_digest_cache';
export const EDITIONS_KEY = 'curator_editions';
export const SAVED_ARTICLES_KEY = 'curator_saved_articles';
export const DIGEST_HISTORY_KEY = 'curator_digest_history';
export const READING_STATS_KEY = 'curator_reading_stats';
export const READ_ARTICLES_KEY = 'curator_read_articles';
export const SAVED_IDS_KEY = 'curator_saved_ids';
export const SEMANTIC_FEEDBACK_KEY = 'curator_semantic_feedback';
export const SIGNALS_KEY = 'curator_signals';

export interface StoryIdMigration {
  data: Record<string, string>;
  changed: boolean;
}

type Json = Record<string, any>;

const parse = (raw: string | undefined): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const storyIdOf = (item: Json): string => storyIdFor(text(item.url), text(item.title));

// What a stored story can tell a vote: its own id, the title the vote recorded, and the old
// publication-wide id it used to be filed under. The last is recomputed from the link, because
// a library converted by an earlier run no longer stores the old id itself.
interface StoryRef {
  id: string;
  title: string;
  legacy: string;
}

// Every story still held in full, under the id it was stored with. Old ids are wide (one per
// publication), so an id can name several stories.
const collectStories = (items: unknown, into: Map<string, string[]>, catalogue: StoryRef[]): void => {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const storedId = text(item.id);
    const nextId = storyIdOf(item);
    if (!storedId || !nextId) continue;
    const known = into.get(storedId) || [];
    if (!known.includes(nextId)) known.push(nextId);
    into.set(storedId, known);
    catalogue.push({
      id: nextId,
      title: text(item.title),
      legacy: legacyStoryIdFor(text(item.url), text(item.title)),
    });
  }
};

const normalizeTitle = (value: string): string =>
  value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

// The one story on file from this publication whose title the vote recorded. A title alone is
// not enough — round-ups repeat across publications — so the old id has to agree too. Two
// different stories sharing a title under the same publication cannot both be meant.
function storyForVote(storedId: string, title: string, catalogue: StoryRef[]): string {
  const wanted = normalizeTitle(title);
  if (!storedId || !wanted) return '';
  const ids = new Set<string>();
  for (const story of catalogue) {
    if (!story.legacy || story.legacy !== storedId) continue;
    if (normalizeTitle(story.title) !== wanted) continue;
    ids.add(story.id);
  }
  return ids.size === 1 ? [...ids][0] : '';
}

// Rewrites a list of stories to their own ids, dropping duplicates the old scheme collapsed.
const rewriteStories = (items: unknown): { items: Json[]; changed: boolean } => {
  if (!Array.isArray(items)) return { items: [], changed: false };
  const seen = new Set<string>();
  const kept: Json[] = [];
  let changed = false;
  for (const item of items) {
    if (!isRecord(item)) {
      changed = true;
      continue;
    }
    const storedId = text(item.id);
    const id = storyIdOf(item) || storedId;
    if (!id || seen.has(id)) {
      changed = true;
      continue;
    }
    seen.add(id);
    if (id !== storedId) changed = true;
    kept.push({ ...item, id });
  }
  return { items: kept, changed };
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function migrateStoryIds(data: Record<string, string>): StoryIdMigration {
  const next: Record<string, string> = { ...data };
  let changed = false;

  // 1. The stories the browser can still name: the edition on screen, the kept editions, saves.
  const stories = new Map<string, string[]>();
  const catalogue: StoryRef[] = [];
  const cache = parse(next[DIGEST_CACHE_KEY]);
  if (isRecord(cache)) collectStories(cache.items, stories, catalogue);
  const editions = parse(next[EDITIONS_KEY]);
  if (Array.isArray(editions)) {
    editions.forEach(entry => { if (isRecord(entry)) collectStories(entry.items, stories, catalogue); });
  }
  collectStories(parse(next[SAVED_ARTICLES_KEY]), stories, catalogue);

  // 2. Give each of those stories its own id.
  if (isRecord(cache) && Array.isArray(cache.items)) {
    const rewritten = rewriteStories(cache.items);
    if (rewritten.changed) {
      next[DIGEST_CACHE_KEY] = JSON.stringify({ ...cache, items: rewritten.items });
      changed = true;
    }
  }

  if (Array.isArray(editions)) {
    let editionsChanged = false;
    const rewrittenEditions = editions.map(entry => {
      if (!isRecord(entry)) return entry;
      const rewritten = rewriteStories(entry.items);
      if (rewritten.changed) editionsChanged = true;
      return { ...entry, items: rewritten.items };
    });
    if (editionsChanged) {
      next[EDITIONS_KEY] = JSON.stringify(rewrittenEditions);
      changed = true;
    }
  }

  const savedArticles = parse(next[SAVED_ARTICLES_KEY]);
  if (Array.isArray(savedArticles)) {
    const rewritten = rewriteStories(savedArticles);
    if (rewritten.changed) {
      next[SAVED_ARTICLES_KEY] = JSON.stringify(rewritten.items);
      changed = true;
    }
  }

  // A record whose story is no longer stored keeps the id it was recorded under. An id from the
  // new scheme still names its story; an old one is retired by publication when the next request
  // is built. Dropping either would let a story the reader already dealt with come back.
  const carriedIds = (storedId: string): string[] => {
    if (!storedId) return [];
    if (isStoryId(storedId)) return [storedId];
    const known = stories.get(storedId) || [];
    return known.length > 0 ? known : [storedId];
  };

  // 3. The votes. Each one names its publication in the id and its story in the title; the
  // matching story gets the vote back, so the boost or down-rank it taught is no longer wasted
  // on an id no story has. A vote whose story is not on file keeps its words but loses the id.
  const storyIdByLegacyVote = new Map<string, string>();
  const feedback = parse(next[SEMANTIC_FEEDBACK_KEY]);
  if (Array.isArray(feedback)) {
    let feedbackChanged = false;
    const rewrittenFeedback = feedback.map(entry => {
      if (!isRecord(entry)) return entry;
      const storedId = text(entry.id);
      if (isStoryId(storedId)) return entry;
      const id = storyForVote(storedId, text(entry.title), catalogue);
      if (id) storyIdByLegacyVote.set(storedId, id);
      if (id === storedId) return entry;
      feedbackChanged = true;
      return { ...entry, id };
    });
    if (feedbackChanged) {
      next[SEMANTIC_FEEDBACK_KEY] = JSON.stringify(rewrittenFeedback);
      changed = true;
    }
  }

  // The same votes also live as two lists of ids. Only the votes above can say which story an
  // old id meant, so a list entry no vote accounts for is retired rather than left naming a
  // whole publication.
  const signals = parse(next[SIGNALS_KEY]);
  if (isRecord(signals)) {
    let signalsChanged = false;
    const rewriteVoteIds = (value: unknown[]): string[] => {
      const ids: string[] = [];
      for (const entry of value) {
        const storedId = text(entry);
        const id = isStoryId(storedId) ? storedId : storyIdByLegacyVote.get(storedId) || '';
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (!same(ids, value)) signalsChanged = true;
      return ids;
    };
    const nextSignals: Json = { ...signals };
    if (Array.isArray(signals.moreIds)) nextSignals.moreIds = rewriteVoteIds(signals.moreIds);
    if (Array.isArray(signals.lessIds)) nextSignals.lessIds = rewriteVoteIds(signals.lessIds);
    if (signalsChanged) {
      next[SIGNALS_KEY] = JSON.stringify(nextSignals);
      changed = true;
    }
  }

  // 4. The id-only records: what was shown, read and saved, carried across by the stories above.
  const history = parse(next[DIGEST_HISTORY_KEY]);
  if (Array.isArray(history)) {
    const shown = new Map<string, number>();
    let historyChanged = false;
    for (const entry of history) {
      const storedId = isRecord(entry) ? text(entry.id) : '';
      const shownAt = Number(isRecord(entry) ? entry.shownAt : NaN);
      const ids = Number.isFinite(shownAt) ? carriedIds(storedId) : [];
      if (ids.length === 0) {
        historyChanged = true;
        continue;
      }
      if (ids.length > 1 || ids[0] !== storedId) historyChanged = true;
      ids.forEach(id => shown.set(id, Math.max(shown.get(id) || 0, shownAt)));
    }
    if (historyChanged || shown.size !== history.length) {
      next[DIGEST_HISTORY_KEY] = JSON.stringify([...shown].map(([id, shownAt]) => ({ id, shownAt })));
      changed = true;
    }
  }

  const reading = parse(next[READING_STATS_KEY]);
  if (isRecord(reading)) {
    const tally: Json = {};
    let readingChanged = false;
    for (const [storedId, stats] of Object.entries(reading)) {
      const ids = carriedIds(storedId);
      if (ids.length > 1 || ids[0] !== storedId) readingChanged = true;
      ids.forEach(id => {
        // The same story reached twice: keep whichever record got further.
        const previous = tally[id];
        if (!previous || Number((stats as Json)?.lastRead || 0) >= Number(previous?.lastRead || 0)) {
          tally[id] = stats;
        }
      });
    }
    if (readingChanged) {
      next[READING_STATS_KEY] = JSON.stringify(tally);
      changed = true;
    }
  }

  for (const key of [READ_ARTICLES_KEY, SAVED_IDS_KEY]) {
    const list = parse(next[key]);
    if (!Array.isArray(list)) continue;
    const ids: string[] = [];
    let listChanged = false;
    for (const value of list) {
      const storedId = text(value);
      const carried = carriedIds(storedId);
      if (carried.length > 1 || carried[0] !== storedId) listChanged = true;
      carried.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    }
    if (listChanged || !same(ids, list)) {
      next[key] = JSON.stringify(ids);
      changed = true;
    }
  }

  return { data: next, changed };
}
