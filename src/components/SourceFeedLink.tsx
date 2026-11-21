import type { SyntheticEvent } from 'react';
import { ExternalLink } from 'lucide-react';

interface SourceFeedLinkProps {
  href?: string;
  title: string;
  feedUrl?: string;
  /** The feed address as the reader sees it. */
  address: string;
  avatarUrl?: string;
  onAvatarLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  /** Extra layout classes for the row that owns the link. */
  className?: string;
}

// One link for a whole source row, shared by working and failed feeds alike: the avatar,
// the name and the address all open that feed, so a reader gets one tab stop per feed
// instead of two links to the same place.
export function SourceFeedLink({
  href,
  title,
  feedUrl,
  address,
  avatarUrl,
  onAvatarLoad,
  className = '',
}: SourceFeedLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${feedUrl} (opens in a new window)`}
      className={`group flex min-w-0 items-start gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 ${className}`}
    >
      <span className="w-9 h-9 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0 relative transition group-hover:border-amber-500/50">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover rounded-full"
            onLoad={onAvatarLoad}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
              const fallback = e.currentTarget.parentElement?.querySelector('.src-list-initials');
              if (fallback) fallback.classList.remove('hidden');
            }}
          />
        ) : null}
        <span className={`src-list-initials text-xs font-bold text-amber-400 ${avatarUrl ? 'hidden' : ''}`}>
          {title.slice(0, 2).toUpperCase()}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-100 truncate leading-snug">{title}</span>
        <span className="mt-0.5 flex max-w-full items-center gap-1 text-xs text-slate-500 transition group-hover:text-amber-300">
          <span className="truncate">{address}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </span>
      </span>
    </a>
  );
}
