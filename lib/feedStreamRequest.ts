// The feeds stream and the manual refreshes, outside the screen: what is asked for, what the
// rows mean, and what the reader is told when a feed answers or does not. The digest request
// already moved; these are the same shape, so a run of overlapping fetches can share one story.

import { RETIRE_AFTER_FAILURES } from './sourceRetirement.ts';

export interface FeedStreamPayload {
  sourceTitle: string;
  sources: unknown[];
}

export interface SingleFeedPayload extends FeedStreamPayload {
  sourceId: string;
  force: true;
}

export interface RefreshAllPayload extends FeedStreamPayload {
  refreshAll: true;
}

// Paused feeds stay in the library and out of every request, so the screen hands the feeds it
// actually read rather than the module deciding what "readable" means.
export function buildFeedStreamRequest(sourceTitle: string | undefined, sources: unknown[]): FeedStreamPayload {
  return { sourceTitle: sourceTitle || 'all', sources };
}

// A manual refresh of one feed bypasses the calm path: it is the reader asking now, so it takes
// the whole library (a feed paused by failures can still be re-read by hand) and forces the
// server past its five-minute feed cache.
export function buildSingleFeedRequest(source: { id: string; title: string }, sources: unknown[]): SingleFeedPayload {
  return { sourceId: source.id, sourceTitle: source.title, sources, force: true };
}

export function buildRefreshAllRequest(sourceTitle: string, sources: unknown[]): RefreshAllPayload {
  return { sourceTitle, sources, refreshAll: true };
}

export interface FeedStreamResponse {
  status: number;
  data: any;
}

export async function postFeedStream(
  payload: FeedStreamPayload | SingleFeedPayload | RefreshAllPayload,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<FeedStreamResponse> {
  const doFetch = options.fetchImpl || fetch;
  const response = await doFetch('/api/feed-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  // A proxy can answer with HTML while the server restarts; that is read as nothing, not a crash.
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

// The stream sets what it got, even when that is nothing: a reply that is not a list sets
// nothing, so a damaged answer can never clear the list by accident.
export function readFeedStreamArticles<T>(data: any): T[] | null {
  if (!data || typeof data !== 'object') return null;
  return Array.isArray(data.articles) ? (data.articles as T[]) : null;
}

export type SingleSourceOutcome<T> =
  | { fetched: true; articles: T[] }
  | { fetched: false; articles: never[]; failingReason: string };

export const SINGLE_SOURCE_NETWORK_REASON = 'Network error while refreshing this feed.';
export const SINGLE_REFRESH_FAILED_TOAST = 'Could not refresh that feed';

export function readSingleSourceOutcome<T>(status: number, data: any): SingleSourceOutcome<T> {
  const articles: T[] = Array.isArray(data?.articles) ? data.articles : [];
  const ok = status >= 200 && status < 300;
  if (ok && articles.length > 0) return { fetched: true, articles };
  return {
    fetched: false,
    articles: [],
    failingReason: ok ? 'This feed returned no articles.' : String(data?.error || `Feed returned HTTP ${status}.`),
  };
}

export interface RefreshRowResult {
  id?: string;
  title?: string;
  ok?: boolean;
  itemCount?: number;
  error?: string;
}

export function findRefreshRow(
  rows: RefreshRowResult[],
  source: { id: string; title: string },
): RefreshRowResult | undefined {
  return rows.find(
    row =>
      (Boolean(row.id) && row.id === source.id) ||
      String(row.title || '').trim().toLowerCase() === source.title.trim().toLowerCase(),
  );
}

export type RefreshAllOutcome<T> =
  | { kind: 'error'; message: string }
  | { kind: 'ok'; articles: T[]; rows: RefreshRowResult[] };

export const REFRESH_ALL_TRANSPORT_TOAST = 'Could not refresh your feeds';

export function readRefreshAllOutcome<T>(status: number, data: any): RefreshAllOutcome<T> {
  if (status < 200 || status >= 300) {
    return { kind: 'error', message: String(data?.error || REFRESH_ALL_TRANSPORT_TOAST) };
  }
  return {
    kind: 'ok',
    articles: Array.isArray(data?.articles) ? data.articles : [],
    rows: Array.isArray(data?.sources) ? data.sources : [],
  };
}

export interface RefreshRowUpdate {
  lastSyncedAt?: number;
  status: 'active' | 'failing';
  failingReason?: string;
  consecutiveFailures?: number;
  paused?: boolean;
  pausedReason?: string;
}

// Returns null when the row says nothing new about the source, so a quiet digest does not churn
// the sources list into a write.
export function refreshAllSourceUpdate(
  row: RefreshRowResult | undefined,
  current: { consecutiveFailures?: number; paused?: boolean; pausedReason?: string },
  now: number,
  threshold: number = RETIRE_AFTER_FAILURES,
): RefreshRowUpdate | null {
  if (!row) return null;
  if (row.ok) {
    return {
      lastSyncedAt: now,
      status: 'active',
      failingReason: undefined,
      consecutiveFailures: 0,
      paused: false,
      pausedReason: undefined,
    };
  }
  const previous = Number.isFinite(current.consecutiveFailures) ? Number(current.consecutiveFailures) : 0;
  const consecutiveFailures = previous + 1;
  const pausesNow = consecutiveFailures >= Math.max(1, threshold);
  return {
    status: 'failing',
    failingReason: row.error || 'This feed returned no articles.',
    consecutiveFailures,
    ...(pausesNow ? { paused: true, pausedReason: current.pausedReason || `Paused after ${consecutiveFailures} failed reads in a row.` } : {}),
  };
}

// The wrap-up names what happened: every feed, most feeds, or only the entries themselves,
// because "refreshed" means nothing when nothing was ever counted.
export function refreshAllToast(rows: RefreshRowResult[], articleCount: number): string {
  if (rows.length > 0) {
    const answered = rows.filter(row => row.ok).length;
    return answered === rows.length
      ? `Refreshed all ${rows.length} feeds`
      : `Refreshed ${answered} of ${rows.length} feeds — the rest did not answer`;
  }
  return `Refreshed ${articleCount} ${articleCount === 1 ? 'entry' : 'entries'}`;
}
