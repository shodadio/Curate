// The lock screen, the headphones and the car are a separate surface from the page: with the
// phone in a pocket there is nothing to tap, so the reading has to say what it is playing and
// accept commands from there. Everything here is guarded — a browser without the API shows
// nothing and must not fail.

export interface ListeningCommands {
  play: () => void;
  pause: () => void;
  stop: () => void;
  nextPiece: () => void;
  previousPiece: () => void;
  nextSentence: () => void;
  previousSentence: () => void;
}

export interface ListeningPiece {
  title: string;
  source: string;
}

// A headphone button arrives as a track skip, so pieces are the tracks and the skip buttons
// beside the title are the sentences — the only two shapes the platform offers.
const COMMANDS: { action: MediaSessionAction; command: keyof ListeningCommands }[] = [
  { action: 'play', command: 'play' },
  { action: 'pause', command: 'pause' },
  { action: 'stop', command: 'stop' },
  { action: 'nexttrack', command: 'nextPiece' },
  { action: 'previoustrack', command: 'previousPiece' },
  { action: 'seekforward', command: 'nextSentence' },
  { action: 'seekbackward', command: 'previousSentence' },
];

const ARTWORK = [
  { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
];

function mediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  const found = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
  return found ?? null;
}

/**
 * Points the lock screen's buttons at the app's own commands. `get` is asked on every press, so
 * the buttons always run against the newest state; passing null leaves the surface bare again.
 */
export function registerListeningCommands(get: (() => ListeningCommands | null) | null): void {
  const media = mediaSession();
  if (!media) return;
  for (const { action, command } of COMMANDS) {
    try {
      media.setActionHandler(action, get ? () => get()?.[command]() : null);
    } catch {
      // An action this browser does not know is one its lock screen never offers
    }
  }
}

/** What the lock screen says is playing. A null piece clears it, so a stopped queue goes quiet. */
export function setListeningPiece(piece: ListeningPiece | null, state: MediaSessionPlaybackState): void {
  const media = mediaSession();
  if (!media) return;
  media.playbackState = state;
  if (!piece) {
    media.metadata = null;
    return;
  }
  if (typeof MediaMetadata === 'undefined') return;
  media.metadata = new MediaMetadata({
    title: piece.title,
    artist: piece.source,
    album: 'The Curator',
    artwork: ARTWORK,
  });
}
