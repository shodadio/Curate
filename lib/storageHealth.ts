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
