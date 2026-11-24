// The neural voices speak through one audio element for the whole app. Keeping it here rather
// than in the reader keeps that component to queue bookkeeping, and keeps the iOS unlock in one
// place: Safari only lets an element play later if it played once inside the tap that started
// the reading.
import { silentWavDataUri, trimTrailingSilenceWav } from '../../lib/wav';

interface PlayHandlers {
  onEnded: () => void;
  onError: (reason?: unknown) => void;
}

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
// A sentence is loaded and playing, as opposed to the pause between two sentences
let loaded = false;
// Sentences after the one playing, oldest first. Generating them early is what keeps the gaps
// short; two covers a short sentence, whose own audio can end before the next one arrives.
const PREFETCH_AHEAD = 2;
let prefetched: { key: string; audio: Promise<Blob> }[] = [];

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

// Both neural voices return a WAV, and each one closes the sentence with a beat of silence of
// its own. Left in place that beat is what the reader hears as a long pause after the full
// stop, so it goes before the clip is queued. A clip that cannot be read is played as it came.
export async function trimSpeechSilence(blob: Blob): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const trimmed = trimTrailingSilenceWav(bytes);
    if (trimmed === bytes) return blob;
    return new Blob([trimmed as unknown as BlobPart], { type: blob.type || 'audio/wav' });
  } catch {
    return blob;
  }
}

export function primeSpeechAudio(): void {
  const player = element();
  player.src = silentWavDataUri();
  void player.play().catch(() => {});
}

export function prefetchSpeechAudio(key: string, render: () => Promise<Blob>): void {
  if (!key || prefetched.some(entry => entry.key === key)) return;
  const job = render();
  // A prefetch nobody waits for must not surface as an unhandled rejection
  job.catch(() => {});
  prefetched.push({ key, audio: job });
  // Reading on past a sentence leaves its prefetch behind; the oldest is the one to drop
  while (prefetched.length > PREFETCH_AHEAD) prefetched.shift();
}

export function takePrefetchedSpeechAudio(key: string): Promise<Blob> | null {
  const at = prefetched.findIndex(entry => entry.key === key);
  if (at === -1) return null;
  const [entry] = prefetched.splice(at, 1);
  return entry.audio;
}

export function playSpeechAudio(blob: Blob, rate: number, handlers: PlayHandlers): void {
  const player = element();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  player.src = objectUrl;
  player.playbackRate = rate;
  loaded = true;

  player.onended = () => {
    loaded = false;
    handlers.onEnded();
  };
  player.onerror = () => {
    loaded = false;
    handlers.onError();
  };
  void player.play().catch(error => {
    loaded = false;
    handlers.onError(error);
  });
}

// True when a sentence was paused mid-flight and is picked up where it stopped
export function resumeSpeechAudio(onLost: () => void): boolean {
  if (!loaded || !audio?.src) return false;
  void audio.play().catch(() => {
    loaded = false;
    onLost();
  });
  return true;
}

export function pauseSpeechAudio(): boolean {
  if (!loaded || !audio?.src) return false;
  audio.pause();
  return true;
}

export function stopSpeechAudio(): void {
  prefetched = [];
  loaded = false;
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}
