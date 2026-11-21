// The digest request, outside the screen: what is sent, what comes back, and what the reader is
// told when nothing does. Keeping it here means the payload shape, the freshness history and
// the wording of every failure can be tested without mounting the app.

export interface ShownEntry {
  id: string;
  shownAt: number;
}

// The provider settings the reader configured. They travel as request fields rather than being
// stored on the server, so the module never decides which provider is used — it only carries it.
export interface DigestModel {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingProvider: string;
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
}

export interface DigestRequestInput {
  sources: unknown[];
  // Taken as a plain object so the screen's own signal type travels through untouched; only the
  // vote ids are read from it.
  signals: object;
  interests: { more: string[]; less: string[] };
  feedback: unknown[];
  readingStats: Record<string, unknown>;
  shownHistory: ShownEntry[];
  currentDigestIds: string[];
  savedIds: string[];
  mutedIds: string[];
  serendipityDial: number;
  itemCount: number;
  model: DigestModel;
  fresh: boolean;
  now?: number;
  random?: () => number;
}

export interface DigestRequestPayload {
  sources: unknown[];
  signals: Record<string, unknown>;
  feedback: unknown[];
  readingStats: Record<string, unknown>;
  serendipityDial: number;
  itemCount: number;
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingProvider: string;
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
  recentlyShown: ShownEntry[];
  previousDigestIds: string[];
  actionedIds: string[];
  fresh: boolean;
  seed: string;
}

export const DIGEST_HISTORY_LIMIT = 150;
export const EMPTY_DIGEST_TOAST = 'Nothing new in 24 hours — older stories are in Feeds';

// Only entries the app itself can act on are read back: a damaged history shortens freshness
// memory rather than throwing away the request.
export function readShownHistory(raw: string | null): ShownEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ShownEntry =>
        Boolean(entry) &&
        typeof entry === 'object' &&
        typeof (entry as ShownEntry).id === 'string' &&
        Number.isFinite((entry as ShownEntry).shownAt),
      )
      .slice(-DIGEST_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function readReadingStats(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function signalIds(signals: object): { moreIds?: string[]; lessIds?: string[] } {
  return (signals || {}) as { moreIds?: string[]; lessIds?: string[] };
}

// The server caps this list and an edition only draws on the last day of publishing, so the most
// recently read stories come first: one read an hour ago must survive the cap ahead of one read
// weeks ago.
function readingIdsByRecency(readingStats: Record<string, unknown>): string[] {
  const lastReadAt = (id: string): number => {
    const stats = readingStats[id];
    const stamp = stats && typeof stats === 'object' ? Number((stats as { lastRead?: unknown }).lastRead) : 0;
    return Number.isFinite(stamp) ? stamp : 0;
  };
  return Object.keys(readingStats).sort((a, b) => lastReadAt(b) - lastReadAt(a));
}

// Every action in the profile is named, so no build — refresh or ordinary — can hand back a
// story the reader already saved, opened, voted on or hid.
function actionedIdsFor(input: DigestRequestInput): string[] {
  const signalVotes = signalIds(input.signals);
  const readingIds = readingIdsByRecency(input.readingStats || {});
  return Array.from(new Set([
    ...input.savedIds,
    ...input.mutedIds,
    ...(signalVotes.moreIds || []),
    ...(signalVotes.lessIds || []),
    ...readingIds,
  ]));
}

export function buildDigestRequest(input: DigestRequestInput): DigestRequestPayload {
  const currentIds = new Set(input.currentDigestIds);
  // The edition already on screen is not "already shown": the server only down-weights pieces
  // the reader has moved past.
  const recentlyShown = input.shownHistory.filter(entry => !currentIds.has(entry.id));
  const now = input.now ?? Date.now();
  const random = input.random ?? Math.random;

  return {
    sources: input.sources,
    signals: {
      ...(input.signals as Record<string, unknown>),
      moreTopics: input.interests.more,
      lessTopics: input.interests.less,
    },
    feedback: input.feedback,
    readingStats: input.readingStats,
    serendipityDial: input.serendipityDial,
    itemCount: input.itemCount,
    provider: input.model.provider,
    apiKey: input.model.apiKey,
    baseUrl: input.model.baseUrl,
    model: input.model.model,
    embeddingProvider: input.model.embeddingProvider,
    embeddingApiKey: input.model.embeddingApiKey,
    embeddingBaseUrl: input.model.embeddingBaseUrl,
    embeddingModel: input.model.embeddingModel,
    recentlyShown,
    previousDigestIds: input.currentDigestIds,
    actionedIds: actionedIdsFor(input),
    fresh: input.fresh,
    // A fresh round is allowed to rotate the library differently; a normal build stays stable so
    // two devices asking at once receive the same edition.
    seed: input.fresh ? `${now}-${random()}` : 'stable',
  };
}

export interface DigestResponse {
  status: number;
  data: any;
}

export async function postDigest(
  payload: DigestRequestPayload,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<DigestResponse> {
  const doFetch = options.fetchImpl || fetch;
  const response = await doFetch('/api/curate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  // A proxy can answer with HTML while the server restarts; that is not a reason to throw.
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

export type DigestOutcome<T> =
  | { kind: 'edition'; items: T[]; semanticSummary?: any; feedReport?: any }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; surface: 'card' | 'toast' };

// Whether a failure replaces the empty screen or arrives as a toast is a screen decision, so it
// is decided from whether the reader already has an edition in front of them.
export function digestOutcome<T>(status: number, data: any, hadEdition: boolean): DigestOutcome<T> {
  if (status < 200 || status >= 300) {
    const message = data?.error
      ? `Curator could not build the digest: ${String(data.error).slice(0, 200)}`
      : `Curator’s server returned HTTP ${status}.`;
    return { kind: 'error', message, surface: hadEdition ? 'toast' : 'card' };
  }
  if (Array.isArray(data?.digest) && data.digest.length > 0) {
    return {
      kind: 'edition',
      items: data.digest as T[],
      semanticSummary: data.semanticSummary,
      feedReport: data.feedReport,
    };
  }
  return { kind: 'empty' };
}

export interface DigestTransportFailure {
  message: string;
  toast: string;
  offline: true;
}

// A request that never answered is not the same as a server that refused: one may be waking up,
// the other has already said why. Both leave the cached edition on screen.
export function digestTransportFailure(timedOut: boolean): DigestTransportFailure {
  return timedOut
    ? {
        message: 'Curator’s server did not answer in time. It may be waking up from idle — try again in a moment.',
        toast: 'Digest took too long — try refreshing again',
        offline: true,
      }
    : {
        message: 'Could not reach Curator’s server. Check your connection and try again.',
        toast: 'Could not refresh the digest',
        offline: true,
      };
}

// The next request has to know the new edition was shown, without forgetting when older pieces
// were, so the two lists merge by id and the oldest entries fall off the end.
export function shownHistoryAfter(
  history: ShownEntry[],
  items: Array<{ id: string }>,
  shownAt: number,
  limit: number = DIGEST_HISTORY_LIMIT,
): ShownEntry[] {
  const freshIds = new Set(items.map(item => item.id));
  return [
    ...history.filter(entry => !freshIds.has(entry.id)),
    ...items.map(item => ({ id: item.id, shownAt })),
  ].slice(-limit);
}
