import React from 'react';
import { EyeOff, RefreshCw, RotateCcw, Rss } from 'lucide-react';

interface DigestEmptyStateProps {
  /** "muted" when every story in the digest was given a thumbs-down. */
  mode: 'quiet' | 'muted';
  mutedCount: number;
  loading: boolean;
  onRefresh: () => void;
  onRestoreMuted: () => void;
  onManageSources: () => void;
}

export function DigestEmptyState({
  mode,
  mutedCount,
  loading,
  onRefresh,
  onRestoreMuted,
  onManageSources,
}: DigestEmptyStateProps) {
  const isMuted = mode === 'muted';
  const headingId = isMuted ? 'digest-empty-muted-heading' : 'digest-empty-quiet-heading';
  const restoreLabel = mutedCount === 1 ? 'Restore the hidden story' : `Restore ${mutedCount} hidden stories`;

  return (
    <section
      aria-labelledby={headingId}
      className="animate-fade-in rounded-3xl border border-slate-800 bg-slate-900/60 px-6 py-10 text-center shadow-sm"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-slate-800 bg-slate-950">
        {isMuted ? (
          <EyeOff className="h-5 w-5 text-slate-400" />
        ) : (
          <Rss className="h-5 w-5 text-slate-400" />
        )}
      </div>

      <div role="status">
        <h3 id={headingId} className="text-base font-semibold tracking-tight text-slate-100">
          {isMuted ? "Nothing left in today's digest" : "No stories in today's digest"}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
          {isMuted
            ? "You marked every story here \u201cLess like this\u201d, so there is nothing left to read. Restore them to pick up where you left off, or refresh for a new mix."
            : 'Your feeds are quiet right now. Refresh to look again, or check that your sources are still reachable.'}
        </p>
      </div>

      <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        {isMuted && mutedCount > 0 && (
          <button
            type="button"
            onClick={onRestoreMuted}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-500/20 px-4 text-sm font-semibold text-amber-300 border border-amber-500/40 transition hover:bg-amber-500/30"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{restoreLabel}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50 ${
            isMuted
              ? 'border border-slate-700 bg-slate-950/80 text-slate-200 hover:border-amber-500/40 hover:text-amber-300'
              : 'border border-amber-500/40 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Refreshing…' : 'Refresh your digest'}</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onManageSources}
        className="mt-4 min-h-11 text-xs text-slate-400 underline underline-offset-2 transition hover:text-amber-300"
      >
        Manage sources
      </button>
    </section>
  );
}
