// A digest only draws on the last 24 hours, so a morning the reader does not open is a morning
// whose edition is gone for good. Keeping the last few editions turns that hole into a short
// "what you missed" list — the app's promise is a finite daily edition, not a memory test.
//
// Only what a card needs is kept: the bodies of the pieces stay wherever they already were, so
// an edition costs kilobytes rather than the whole article text.

export interface EditionItem {
  id: string;
  title: string;
  source: string;
  folder?: string;
  summary?: string;
  url?: string;
  readTime?: string;
  author?: string;
  publishedAt?: string;
  isOutOfBubble?: boolean;
}

export interface Edition {
  // When the edition was built, so two builds on one day replace rather than stack.
  curatedAt: number;
  items: EditionItem[];
}

export const MAX_EDITIONS = 6;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

// A digest entry carries a lot the archive does not need: full text, link state, reading
// markers. Picking the fields explicitly keeps a stray save from ballooning the stored file.
export function editionItem(item: EditionItem): EditionItem {
  return {
    id: text(item.id),
    title: text(item.title),
    source: text(item.source),
    folder: text(item.folder) || undefined,
    summary: text(item.summary),
    url: text(item.url) || undefined,
    readTime: text(item.readTime) || undefined,
    author: text(item.author) || undefined,
    publishedAt: text(item.publishedAt) || undefined,
    isOutOfBubble: Boolean(item.isOutOfBubble),
  };
}

const sameDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString();

// One edition per calendar day, newest first. A later build on the same day replaces the
// earlier one: the archive is of editions the reader could have read, not of every run.
export function recordEdition(
  history: Edition[],
  curatedAt: number,
  items: EditionItem[],
  max: number = MAX_EDITIONS,
): Edition[] {
  if (!Number.isFinite(curatedAt) || !Array.isArray(items) || items.length === 0) return history;
  const kept = editionItemList(items);
  if (kept.length === 0) return history;
  const withoutThatDay = history.filter(entry =>
    entry && Number.isFinite(entry.curatedAt) && !sameDay(entry.curatedAt, curatedAt),
  );
  return [{ curatedAt, items: kept }, ...withoutThatDay]
    .sort((a, b) => b.curatedAt - a.curatedAt)
    .slice(0, Math.max(1, max));
}

function editionItemList(items: EditionItem[]): EditionItem[] {
  const seen = new Set<string>();
  const result: EditionItem[] = [];
  for (const item of items) {
    const picked = editionItem(item);
    if (!picked.id || !picked.title || seen.has(picked.id)) continue;
    seen.add(picked.id);
    result.push(picked);
  }
  return result;
}

// Reads what earlier builds stored without trusting it: a damaged entry is dropped, never
// allowed to break the screen that lists the archive.
export function readEditions(raw: string | null): Edition[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Edition =>
      Boolean(entry) && typeof entry === 'object' &&
      Number.isFinite((entry as Edition).curatedAt) &&
      Array.isArray((entry as Edition).items),
    )
    .map(entry => ({
      curatedAt: entry.curatedAt,
      items: entry.items.filter(item => item && typeof item === 'object').map(item => editionItem(item as EditionItem)),
    }))
    .filter(entry => entry.items.length > 0)
    .sort((a, b) => b.curatedAt - a.curatedAt)
    .slice(0, MAX_EDITIONS);
}

// "Thu 20 Nov" — the day is what a reader is looking for, not the minute it was built.
export function editionDayLabel(curatedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(curatedAt)) return 'Undated edition';
  const at = new Date(curatedAt);
  const today = new Date(now).toDateString();
  const yesterday = new Date(now - 24 * 60 * 60 * 1000).toDateString();
  if (at.toDateString() === today) return 'Today';
  if (at.toDateString() === yesterday) return 'Yesterday';
  return at.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function editionMinutes(items: EditionItem[]): number {
  return items.reduce((total, item) => total + (parseInt(item.readTime || '', 10) || 0), 0);
}
