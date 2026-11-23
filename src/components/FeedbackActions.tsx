import React from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

interface FeedbackActionsProps {
  isMore: boolean;
  isLess: boolean;
  onMore: () => void;
  onLess: () => void;
  // The reader draws its own reading surface, so its buttons follow the theme rather than
  // the app's dark chrome.
  tone?: 'default' | 'reader';
}

export function FeedbackActions({ isMore, isLess, onMore, onLess, tone = 'default' }: FeedbackActionsProps) {
  const onReader = tone === 'reader';
  const moreClasses = onReader
    ? 'reader-button'
    : isMore
      ? 'bg-[#1c1a17] border-[#1c1a17] text-[#f6f1e7] shadow-sm'
      : 'bg-transparent border-[#c9bc9f] text-[#6f675c] hover:text-[#1c1a17] hover:border-[#1c1a17]';
  const lessClasses = onReader
    ? 'reader-button'
    : isLess
      ? 'bg-[#1c1a17] border-[#1c1a17] text-[#f6f1e7] shadow-sm'
      : 'bg-transparent border-[#c9bc9f] text-[#6f675c] hover:text-[#1c1a17] hover:border-[#1c1a17]';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onMore(); }}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border transition ${moreClasses}`}
        data-sentiment={onReader ? 'more' : undefined}
        title={isMore ? 'More like this, selected' : 'More like this'}
        aria-label={isMore ? 'More like this, selected' : 'More like this'}
        aria-pressed={isMore}
      >
        <ThumbsUp className={`w-4 h-4 ${isMore ? (onReader ? 'fill-current opacity-25' : 'fill-current') : ''}`} />
      </button>
      <button
        type="button"
        onClick={event => { event.stopPropagation(); onLess(); }}
        className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border transition ${lessClasses}`}
        data-sentiment={onReader ? 'less' : undefined}
        title={isLess ? 'Less like this, selected' : 'Less like this'}
        aria-label={isLess ? 'Less like this, selected' : 'Less like this'}
        aria-pressed={isLess}
      >
        <ThumbsDown className={`w-4 h-4 ${isLess ? (onReader ? 'fill-current opacity-25' : 'fill-current') : ''}`} />
      </button>
    </div>
  );
}
