import type { SyntheticEvent } from 'react';
import { ExternalLink } from 'lucide-react';

interface SourceFeedLinkProps {
  /** Opens this source's feed stream in the Feeds tab. */
  onOpen: () => void;
  title: string;
  feedUrl?: string;
  /** The feed address as the reader sees it. */
  address: string;
  avatarUrl?: string;
  onAvatarLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  /** Extra layout classes for the row that owns the link. */
  className?: string;
}

// One control for a whole source row, shared by working and failed feeds alike: the avatar,
// the name and the address all open that source's feed stream, so a reader gets one tap stop
// per feed instead of two links to the same place.
export function SourceFeedLink({
  onOpen,
  title,
  feedUrl,
  address,
  avatarUrl,
  onAvatarLoad,
  className = '',
}: SourceFeedLinkProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${feedUrl} (opens in Feeds)`}
      className={`group w-full min-w-0 cursor-pointer text-left flex items-start gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a24]/50 ${className}`}
    >
      <span className="w-9 h-9 rounded-full bg-[#ece4d1] border border-[#c9bc9f] flex items-center justify-center overflow-hidden shrink-0 relative transition group-hover:border-[#1c1a17]">
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
        <span className={`src-list-initials text-xs font-bold text-[#1c1a17] ${avatarUrl ? 'hidden' : ''}`}>
          {title.slice(0, 2).toUpperCase()}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[#1c1a17] truncate leading-snug">{title}</span>
        <span className="mt-0.5 flex max-w-full items-center gap-1 text-xs text-[#6f675c] transition group-hover:text-[#1c1a17]">
          <span className="truncate">{address}</span>
          <ExternalLink className="w-3 h-3 shrink-0" />
        </span>
      </span>
    </button>
  );
}
