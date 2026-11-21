import { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { videoWatchUrl, type VideoEmbed } from '../../lib/videoEmbed';

interface ReaderVideoProps {
  video: VideoEmbed;
  /** The piece's headline, for the frame's accessible name. */
  title: string;
}

// A video the piece carries, shown inside the reader rather than behind a trip to the publisher.
// A video file plays in the page's own player; a YouTube or Vimeo piece is held behind a still
// until the reader asks for it, because loading the frame contacts the video host — and a reader
// who never presses play should not be announced to Google or Vimeo before they choose to be.
export function ReaderVideo({ video, title }: ReaderVideoProps) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const watchUrl = videoWatchUrl(video);

  if (failed) {
    return (
      <figure className="reader-video font-sans mt-7">
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="reader-video-fallback"
          title="Open the video in a new window"
        >
          <Play className="h-4 w-4 fill-current" />
          <span>Watch the video</span>
        </a>
      </figure>
    );
  }

  if (video.kind === 'file') {
    return (
      <figure className="reader-video font-sans mt-7">
        <video
          controls
          playsInline
          preload="metadata"
          poster={video.poster}
          onError={() => setFailed(true)}
        >
          <source src={video.url} />
        </video>
      </figure>
    );
  }

  if (!playing) {
    return (
      <figure className="reader-video font-sans mt-7">
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="reader-video-still"
          title="Play the video"
          aria-label={`Play the video in ${title}`}
        >
          {video.poster && <img src={video.poster} alt="" loading="lazy" decoding="async" />}
          <span className="reader-video-play" aria-hidden="true">
            <Play className="h-5 w-5 fill-current" />
          </span>
          <span className="reader-video-caption">Play video</span>
        </button>
      </figure>
    );
  }

  return (
    <figure className="reader-video font-sans mt-7">
      <div className="reader-video-frame">
        <iframe
          src={video.url}
          title={`Video in ${title}`}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setFailed(true)}
        />
      </div>
      {/* A frame that refuses to load leaves an empty box with no explanation, and the browser
          keeps its reason to itself. This line is the way out when that happens. */}
      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="reader-video-open font-sans"
        title="Open the video in a new window"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        <span>Open in a new window</span>
      </a>
    </figure>
  );
}
