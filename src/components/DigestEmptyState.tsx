import React from 'react';
import { EyeOff, RotateCcw, Rss } from 'lucide-react';

interface DigestEmptyStateProps {
  /** "muted" when every story in the digest was given a thumbs-down. */
  mode: 'quiet' | 'muted';
  mutedCount: number;
  onRestoreMuted: () => void;
  onManageSources: () => void;
  /** Opens the Feeds tab, where stories older than the digest window live. */
  onBrowseFeeds?: () => void;
}

export function DigestEmptyState({
  mode,
  mutedCount,
  onRestoreMuted,
  onManageSources,
  onBrowseFeeds,
}: DigestEmptyStateProps) {
  const isMuted = mode === 'muted';
  const headingId = isMuted ? 'digest-empty-muted-heading' : 'digest-empty-quiet-heading';
  const restoreLabel = mutedCount === 1 ? 'Restore the hidden story' : `Restore ${mutedCount} hidden stories`;

  return (
    <section
      aria-labelledby={headingId}
      className="animate-fade-in border-t border-[#ddd2bc] py-10 text-center"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[#c9bc9f] bg-[#ece4d1]">
        {isMuted ? (
          <EyeOff className="h-5 w-5 text-[#6f675c]" />
        ) : (
          <Rss className="h-5 w-5 text-[#6f675c]" />
        )}
      </div>

      <div role="status">
        <h3 id={headingId} className="font-serif text-base font-semibold tracking-tight text-[#1c1a17]">
          {isMuted ? "Nothing left in today's digest" : 'Nothing new in the last 24 hours'}
        </h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#6f675c]">
          {isMuted
            ? "You marked every story here \u201cLess like this\u201d, so there is nothing left to read. Restore them to pick up where you left off, or choose Refresh at the top for a new mix."
            : 'Your feeds have not published anything new in the last 24 hours. Choose Refresh at the top to look again.'}
        </p>
      </div>

      <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        {isMuted && mutedCount > 0 && (
          <button
            type="button"
            onClick={onRestoreMuted}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#1c1a17] px-4 text-sm font-semibold text-[#f6f1e7] border border-[#1c1a17] transition hover:bg-[#3a352d]"
          >
            <RotateCcw className="h-4 w-4" />
            <span>{restoreLabel}</span>
          </button>
        )}
        {!isMuted && onBrowseFeeds && (
          <button
            type="button"
            onClick={onBrowseFeeds}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#c9bc9f] px-4 text-sm font-medium text-[#1c1a17] transition hover:border-[#1c1a17]"
          >
            <Rss className="h-4 w-4" />
            <span>Browse older stories in Feeds</span>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onManageSources}
        className="mt-4 min-h-11 text-xs text-[#6f675c] underline underline-offset-2 transition hover:text-[#1c1a17]"
      >
        Manage sources
      </button>
    </section>
  );
}
