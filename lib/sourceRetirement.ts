// A feed that has been dead for weeks still costs every digest its fetch budget and its place
// in the report, so the Sources list fills with rows that will never produce a story. Counting
// consecutive failures and pausing the source keeps the edition quick and the list honest —
// pausing, never deleting: a publication can come back, and the reader's folders stay intact.

export const RETIRE_AFTER_FAILURES = 5;

export interface FeedOutcome {
  consecutiveFailures: number;
  paused?: boolean;
}

// Only a feed that was actually read this run may have its counter reset; a run that rotated
// past a feed says nothing about it, and treating silence as success would hide real failures.
export function recordFailure(state: FeedOutcome | undefined, threshold: number = RETIRE_AFTER_FAILURES): FeedOutcome {
  const previous = Number.isFinite(state?.consecutiveFailures) ? Number(state?.consecutiveFailures) : 0;
  const consecutiveFailures = previous + 1;
  return {
    consecutiveFailures,
    paused: consecutiveFailures >= Math.max(1, threshold),
  };
}

export function recordSuccess(): FeedOutcome {
  return { consecutiveFailures: 0, paused: false };
}

export function resumeFeed(): FeedOutcome {
  return { consecutiveFailures: 0, paused: false };
}

export interface RetirableSource {
  title: string;
  feedUrl: string;
  consecutiveFailures?: number;
  paused?: boolean;
  pausedReason?: string;
}

const sameFeed = (source: { title?: string; feedUrl?: string }, failed: { title?: string; feedUrl?: string }) => {
  const sourceUrl = (source.feedUrl || '').trim().toLowerCase();
  const failedUrl = (failed.feedUrl || '').trim().toLowerCase();
  if (sourceUrl && failedUrl && sourceUrl === failedUrl) return true;
  const sourceTitle = (source.title || '').trim().toLowerCase();
  const failedTitle = (failed.title || '').trim().toLowerCase();
  return Boolean(sourceTitle) && sourceTitle === failedTitle;
};

// Applies one digest's failure list: each named feed counts a failure, and the source is
// paused on the run that crosses the threshold. Returns the same array when nothing changed,
// so a quiet digest does not churn the sources list into a write.
export function applyFeedFailures<T extends RetirableSource>(
  sources: T[],
  failed: Array<{ title?: string; feedUrl?: string; reason?: string }>,
  threshold: number = RETIRE_AFTER_FAILURES,
): T[] {
  if (!Array.isArray(sources) || sources.length === 0) return sources;
  if (!Array.isArray(failed) || failed.length === 0) return sources;
  let changed = false;
  const next = sources.map(source => {
    const match = failed.find(entry => sameFeed(source, entry));
    if (!match) return source;
    const outcome = recordFailure(
      { consecutiveFailures: source.consecutiveFailures ?? 0, paused: source.paused },
      threshold,
    );
    const pausedNow = Boolean(outcome.paused) && !source.paused;
    changed = true;
    return {
      ...source,
      ...outcome,
      pausedReason: pausedNow
        ? `Paused after ${outcome.consecutiveFailures} failed reads in a row.`
        : source.pausedReason,
    };
  });
  return changed ? next : sources;
}

// The rows a run should read. A paused feed stays in the library and out of the request.
export function activeSources<T extends { paused?: boolean }>(sources: T[]): T[] {
  return Array.isArray(sources) ? sources.filter(source => !source?.paused) : [];
}
