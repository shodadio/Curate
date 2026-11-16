import React from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

interface FeedbackActionsProps {
  isMore: boolean;
  isLess: boolean;
  onMore: () => void;
  onLess: () => void;
}

export function FeedbackActions({ isMore, isLess, onMore, onLess }: FeedbackActionsProps) {
  const moreClasses = isMore
    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300 shadow-sm'
    : 'bg-slate-950/80 border-slate-700/80 text-slate-300 hover:text-amber-300 hover:border-amber-500/40';
  const lessClasses = isLess
    ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 shadow-sm'
    : 'bg-slate-950/80 border-slate-700/80 text-slate-300 hover:text-rose-300 hover:border-rose-500/40';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onMore(); }}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border transition ${moreClasses}`}
        title={isMore ? 'More like this (selected)' : 'Show me more like this'}
        aria-label={isMore ? 'More like this, selected' : 'More like this'}
        aria-pressed={isMore}
      >
        <ThumbsUp className={`w-4 h-4 ${isMore ? 'fill-amber-400/30' : ''}`} />
      </button>
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onLess(); }}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border transition ${lessClasses}`}
        title={isLess ? 'Less like this (selected)' : 'Show me fewer like this'}
        aria-label={isLess ? 'Less like this, selected' : 'Less like this'}
        aria-pressed={isLess}
      >
        <ThumbsDown className={`w-4 h-4 ${isLess ? 'fill-rose-400/30' : ''}`} />
      </button>
    </div>
  );
}
