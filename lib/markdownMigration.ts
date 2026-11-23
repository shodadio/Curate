// Feed writers type their titles and excerpts in Markdown. New stories arrive with the syntax
// already stripped, and the screens clean what they render — but stories saved before either
// change still carry the raw markers in storage. A few places read those stored fields as-is:
// the save toast, the history list, the reader's source note, and the ranking's memory of a
// vote. This walks the stored library once and rewrites those fields to the words they
// already display as everywhere else.
//
// A headline is left alone when the story has no link: without one the headline IS the id,
// and rewriting it would file the story as unread, unsaved and never shown. Those keep their
// markers in storage and the screens go on cleaning them on the way out.
import { stripMarkdownSyntax } from './markup';
import { isStoryId } from './storyId';
import {
  DIGEST_CACHE_KEY,
  EDITIONS_KEY,
  SAVED_ARTICLES_KEY,
  SEMANTIC_FEEDBACK_KEY,
} from './storyIdMigration';

export interface MarkdownMigration {
  data: Record<string, string>;
  changed: boolean;
}

const SOURCES_KEY = 'curator_sources';

type Json = Record<string, any>;

const parse = (raw: string | undefined): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const isRecord = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The words without the syntax. Summaries and blurbs never name anything, so they are always
// rewritten; anything else in storage already reads through the same cleaner on screen.
const words = (value: unknown): string => stripMarkdownSyntax(text(value));

// One stored story, with its headline, excerpt and publication blurb cleaned. The id is only
// rewritten alongside the headline when the link names the story, which it does whenever
// there is one.
const cleanStory = (item: unknown): { item: Json; changed: boolean } => {
  if (!isRecord(item)) return { item: item as Json, changed: false };
  const next: Json = { ...item };
  let changed = false;
  if (text(next.url)) {
    const title = words(next.title);
    if (title !== text(next.title)) {
      next.title = title;
      changed = true;
    }
  }
  for (const key of ['summary', 'sourceDescription']) {
    if (typeof next[key] !== 'string') continue;
    const cleaned = words(next[key]);
    if (cleaned !== next[key]) {
      next[key] = cleaned;
      changed = true;
    }
  }
  return { item: next, changed };
};

const cleanStories = (items: unknown): { items: Json[]; changed: boolean } => {
  if (!Array.isArray(items)) return { items: [], changed: false };
  let changed = false;
  const kept = items.map(entry => {
    if (!isRecord(entry)) return entry;
    const cleaned = cleanStory(entry);
    if (cleaned.changed) changed = true;
    return cleaned.item;
  });
  return { items: kept, changed };
};

// A vote whose story the new scheme names matches by id, so its recorded words can be
// cleaned freely. A vote still filed under an old id matches by its recorded title, and the
// stored story it names may have kept that title raw — those are left for the id migration.
const cleanVote = (entry: unknown): { entry: Json; changed: boolean } => {
  if (!isRecord(entry) || !isStoryId(text(entry.id))) return { entry: entry as Json, changed: false };
  const next: Json = { ...entry };
  let changed = false;
  for (const key of ['title', 'text']) {
    if (typeof next[key] !== 'string') continue;
    const cleaned = words(next[key]);
    if (cleaned !== next[key]) {
      next[key] = cleaned;
      changed = true;
    }
  }
  return { entry: next, changed };
};

export function migrateStoredMarkdown(data: Record<string, string>): MarkdownMigration {
  const next: Record<string, string> = { ...data };
  let changed = false;

  // 1. The stories the browser can still name: the edition on screen, the kept editions, saves.
  const cache = parse(next[DIGEST_CACHE_KEY]);
  if (isRecord(cache) && Array.isArray(cache.items)) {
    const cleaned = cleanStories(cache.items);
    if (cleaned.changed) {
      next[DIGEST_CACHE_KEY] = JSON.stringify({ ...cache, items: cleaned.items });
      changed = true;
    }
  }

  const editions = parse(next[EDITIONS_KEY]);
  if (Array.isArray(editions)) {
    let editionsChanged = false;
    const cleanedEditions = editions.map(entry => {
      if (!isRecord(entry) || !Array.isArray(entry.items)) return entry;
      const cleaned = cleanStories(entry.items);
      if (cleaned.changed) editionsChanged = true;
      return { ...entry, items: cleaned.items };
    });
    if (editionsChanged) {
      next[EDITIONS_KEY] = JSON.stringify(cleanedEditions);
      changed = true;
    }
  }

  const savedArticles = parse(next[SAVED_ARTICLES_KEY]);
  if (Array.isArray(savedArticles)) {
    const cleaned = cleanStories(savedArticles);
    if (cleaned.changed) {
      next[SAVED_ARTICLES_KEY] = JSON.stringify(cleaned.items);
      changed = true;
    }
  }

  // 2. The ranking's memory of a vote: the recorded words, never the id they hang off.
  const feedback = parse(next[SEMANTIC_FEEDBACK_KEY]);
  if (Array.isArray(feedback)) {
    let feedbackChanged = false;
    const cleanedFeedback = feedback.map(entry => {
      const cleaned = cleanVote(entry);
      if (cleaned.changed) feedbackChanged = true;
      return cleaned.entry;
    });
    if (feedbackChanged) {
      next[SEMANTIC_FEEDBACK_KEY] = JSON.stringify(cleanedFeedback);
      changed = true;
    }
  }

  // 3. The feeds themselves: a blurb written in Markdown names no story, so it is always safe.
  const sources = parse(next[SOURCES_KEY]);
  if (Array.isArray(sources)) {
    let sourcesChanged = false;
    const cleanedSources = sources.map(source => {
      if (!isRecord(source) || typeof source.description !== 'string') return source;
      const description = words(source.description);
      if (description === source.description) return source;
      sourcesChanged = true;
      return { ...source, description };
    });
    if (sourcesChanged) {
      next[SOURCES_KEY] = JSON.stringify(cleanedSources);
      changed = true;
    }
  }

  return { data: next, changed };
}
