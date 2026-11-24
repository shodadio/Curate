// The neural voices speak through one audio element for the whole app. Keeping it here rather
// than in the reader keeps that component to queue bookkeeping, and keeps the iOS unlock in one
// place: Safari only lets an element play later if it played once inside the tap that started
// the reading.
import { silentWavDataUri } from '../../lib/wav';

interface PlayHandlers {
  onEnded: () => void;
  onError: (reason?: unknown) => void;
}

let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
// A sentence is loaded and playing, as opposed to the pause between two sentences
let loaded = false;
// The sentence after the one playing. Generating it early is what keeps the gaps short.
let prefetched: { key: string; audio: Promise<Blob> } | null = null;

function element(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.preload = 'auto';
  }
  return audio;
}

export function primeSpeechAudio(): void {
  const player = element();
  player.src = silentWavDataUri();
  void player.play().catch(() => {});
}

export function prefetchSpeechAudio(key: string, render: () => Promise<Blob>): void {
  if (!key || prefetched?.key === key) return;
  const job = render();
  // A prefetch nobody waits for must not surface as an unhandled rejection
  job.catch(() => {});
  prefetched = { key, audio: job };
}

export function takePrefetchedSpeechAudio(key: string): Promise<Blob> | null {
  if (!prefetched || prefetched.key !== key) return null;
  const job = prefetched.audio;
  prefetched = null;
  return job;
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
  prefetched = null;
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
