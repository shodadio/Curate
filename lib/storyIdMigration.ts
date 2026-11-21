// The first id scheme hashed only the opening characters of a link, so every story from one
// publication shared an id. This carries what the browser stored under those ids onto ids of
// the reader's own stories.
//
// An old id cannot say which of a publication's stories it meant. Every story still on file
// under that id inherits the record — the whole point is that an already-read story cannot come
// back, and hiding the other stories the archive remembers from that publication is a one-time
// cost paid for it. An old id with no story on file is dropped: its story is beyond the
// 24-hour window an edition draws from, so no build could hand it back.

import { isStoryId, storyIdFor } from './storyId';

export const DIGEST_CACHE_KEY = 'curator_digest_cache';
export const EDITIONS_KEY = 'curator_editions';
export const SAVED_ARTICLES_KEY = 'curator_saved_articles';
export const DIGEST_HISTORY_KEY = 'curator_digest_history';
export const READING_STATS_KEY = 'curator_reading_stats';
export const READ_ARTICLES_KEY = 'curator_read_articles';
export const SAVED_IDS_KEY = 'curator_saved_ids';

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

// Every story still held in full, under the id it was stored with. Old ids are wide (one per
// publication), so an id can name several stories.
const collectStories = (items: unknown, into: Map<string, string[]>): void => {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const storedId = text(item.id);
    const nextId = storyIdOf(item);
    if (!storedId || !nextId) continue;
    const known = into.get(storedId) || [];
    if (!known.includes(nextId)) known.push(nextId);
    into.set(storedId, known);
  }
};

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
  const cache = parse(next[DIGEST_CACHE_KEY]);
  if (isRecord(cache)) collectStories(cache.items, stories);
  const editions = parse(next[EDITIONS_KEY]);
  if (Array.isArray(editions)) {
    editions.forEach(entry => { if (isRecord(entry)) collectStories(entry.items, stories); });
  }
  collectStories(parse(next[SAVED_ARTICLES_KEY]), stories);

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

  // 3. The id-only records: what was shown, read and saved, carried across by the stories above.
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
