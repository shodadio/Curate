// Local storage is the only copy of a reader's library, and the browser can refuse a write at
// any moment. Rather than waiting for that refusal to arrive as a warning, this module answers
// two questions: what is taking the space, and which part of it is safe to drop.

export interface StorageEntry {
  key: string;
  label: string;
  bytes: number;
}

export interface StorageReport {
  totalBytes: number;
  entries: StorageEntry[];
}

// The names a reader would recognise, rather than the keys the app happens to use.
const STORAGE_LABELS: Record<string, string> = {
  curator_saved_articles: 'Saved article bodies',
  curator_digest_cache: "Last edition's stories",
  curator_semantic_feedback: 'Votes that teach the ranking',
  curator_digest_history: 'Stories already shown',
  curator_reading_stats: 'Reading progress',
  curator_sources: 'Your feeds',
  curator_saved_ids: 'Saved story list',
  curator_weekly_history: 'Weekly reading history',
  curator_editions: 'Earlier editions',
  curator_read_articles: 'Opened stories',
  curator_read_sources: 'Discussed feeds',
  curator_signals: 'Signal tuning',
  curator_interests: 'Declared interests',
  curator_reader_theme: 'Reader appearance',
  curator_reader_face: 'Reader appearance',
  curator_reader_size: 'Reader appearance',
  curator_speech_voice_v4: 'Read-aloud voice',
  curator_speech_rate: 'Read-aloud speed',
};

export function bytesOf(text: string): number {
  if (!text) return 0;
  return new TextEncoder().encode(text).length;
}

export function measureStorage(data: Record<string, string>): StorageReport {
  const entries: StorageEntry[] = Object.keys(data)
    .filter(key => key.startsWith('curator_'))
    .map(key => ({
      key,
      label: STORAGE_LABELS[key] || key,
      bytes: bytesOf(data[key]),
    }))
    .sort((a, b) => b.bytes - a.bytes);
  return {
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    entries,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export interface ReadingStat {
  maxDepth?: number;
  finished?: boolean;
  lastRead?: number;
}

// An edition only reaches back a day, so progress older than this can no longer change what is
// selected. The window is generous because a reader who returns after a break should still find
// their recent reading where they left it.
export const READING_STATS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
// One record per story means a long-lived library collects thousands. This is a session's worth
// of recent reading, small enough not to compete with saved pieces for the quota.
export const READING_STATS_MAX_ENTRIES = 400;

export interface ReadingProfileResult {
  stats: Record<string, ReadingStat>;
  droppedCount: number;
}

// Reading progress is written for every story the reader opens, and nothing ever removed it, so
// the profile grew for as long as the reader kept reading. Keeping the recent slice — and the
// stories still on screen or saved, whose progress the reader can see again — is what ranking and
// the library actually use; the rest can expire.
export function pruneReadingStats(
  stats: Record<string, ReadingStat> | null | undefined,
  options: { now?: number; keepIds?: Iterable<string>; maxAgeMs?: number; maxEntries?: number } = {},
): ReadingProfileResult {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return { stats: {}, droppedCount: 0 };
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? READING_STATS_MAX_AGE_MS;
  const maxEntries = Math.max(0, options.maxEntries ?? READING_STATS_MAX_ENTRIES);
  const keep = new Set(options.keepIds ?? []);
  const entries = Object.entries(stats);

  const recent = entries.filter(([id, stat]) => {
    if (keep.has(id)) return true;
    const lastRead = Number(stat && stat.lastRead);
    // A record with no time is not part of the recent slice: only a story still in front of the
    // reader can hold it.
    return Number.isFinite(lastRead) && now - lastRead <= maxAgeMs;
  });

  // The cap counts everything that is kept, stories on screen included.
  const held = recent.filter(([id]) => keep.has(id)).length;
  const kept = new Set(
    recent
      .filter(([id]) => !keep.has(id))
      .sort((a, b) => Number(b[1] && b[1].lastRead) - Number(a[1] && a[1].lastRead))
      .slice(0, Math.max(0, maxEntries - held))
      .map(([id]) => id),
  );

  const next: Record<string, ReadingStat> = {};
  for (const [id, stat] of entries) {
    if (keep.has(id) || kept.has(id)) next[id] = stat;
  }
  return { stats: next, droppedCount: entries.length - Object.keys(next).length };
}

export interface PruneResult<T> {
  items: T[];
  prunedCount: number;
  freedBytes: number;
}

interface BodyCarrier {
  fullText?: string;
  publishedAt?: string;
}

// The bodies of saved pieces are the largest thing the app stores, and they are also the only
// part that can be fetched again. Keeping the sounds-never-freed rule simple: the newest few
// keep their bodies for offline reading, the rest keep their headline, summary and link.
export function pruneArticleBodies<T extends BodyCarrier>(items: T[], keepNewest: number = 5): PruneResult<T> {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: Array.isArray(items) ? items : [], prunedCount: 0, freedBytes: 0 };
  }
  const dated = items.map((item, index) => ({
    item,
    index,
    at: Date.parse(item?.publishedAt || '') || 0,
  }));
  const keep = new Set(
    dated
      .slice()
      .sort((a, b) => (b.at - a.at) || (b.index - a.index))
      .slice(0, Math.max(0, keepNewest))
      .map(entry => entry.index),
  );
  let prunedCount = 0;
  let freedBytes = 0;
  const next = items.map((item, index) => {
    if (keep.has(index) || !item?.fullText) return item;
    prunedCount += 1;
    freedBytes += bytesOf(item.fullText);
    const { fullText: _dropped, ...rest } = item;
    return rest as T;
  });
  return { items: next, prunedCount, freedBytes };
}
