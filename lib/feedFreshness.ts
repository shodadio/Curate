// "Today" on the Feeds stream: the entries a publisher dated after the reader's own midnight.
// The stream already arrives newest-first, so narrowing it is a filter over the list the page
// holds, not a request. The comparison is on the reader's local calendar (year, month, day) so
// the cutoff really is their midnight, and a daylight-saving shift changes nothing.

// A feed that carries no date cannot be shown to be from today, so it stays out of the narrowed
// stream rather than appearing under a heading that would be guessing.
export function isPublishedToday(item: { publishedAtMs?: number }, nowMs: number = Date.now()): boolean {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return false;
  const publishedAt = new Date(published);
  const today = new Date(nowMs);
  return publishedAt.getFullYear() === today.getFullYear()
    && publishedAt.getMonth() === today.getMonth()
    && publishedAt.getDate() === today.getDate();
}

// Order is kept: the stream's promise is chronological, and the filter only removes rows.
export function todaysEntries<T extends { publishedAtMs?: number }>(items: T[], nowMs: number = Date.now()): T[] {
  return (Array.isArray(items) ? items : []).filter(item => isPublishedToday(item, nowMs));
}
