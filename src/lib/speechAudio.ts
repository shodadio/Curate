// The neural voices speak through one audio element for the whole app. Keeping it here rather
// than in the reader keeps that component to queue bookkeeping, and keeps the iOS unlock in one
// place: Safari only lets an element play later if it played once inside the tap that started
// the reading.
import { silentWavDataUri, trimSilenceWav } from '../../lib/wav';

interface PlayHandlers {
  onEnded: () => void;
  onError: (reason?: unknown) => void;
}

interface SpeechAudioSlot {
  audio: HTMLAudioElement;
  state: 'idle' | 'preparing' | 'prepared' | 'playing';
  objectUrl: string | null;
}

let audioSlots: SpeechAudioSlot[] = [];
let activeAudioSlot: SpeechAudioSlot | null = null;
let preparedAudioByBlob = new WeakMap<Blob, SpeechAudioSlot>();
let prefetchGeneration = 0;
// A sentence is loaded and playing, as opposed to the pause between two audio clips
let loaded = false;
// Keep the next sentence plus the two future sentences generated ahead by the reader. The next
// sentence is still needed when the lookahead window advances, so the cache must hold all three.
const PREFETCH_AHEAD = 3;
let prefetched: { key: string; audio: Promise<Blob> }[] = [];

function createSpeechAudioSlot(): SpeechAudioSlot | null {
  if (typeof Audio === 'undefined') return null;
  const player = new Audio();
  player.preload = 'auto';
  const slot: SpeechAudioSlot = { audio: player, state: 'idle', objectUrl: null };
  audioSlots.push(slot);
  return slot;
}

function idleSpeechAudioSlot(): SpeechAudioSlot | null {
  return audioSlots.find(slot => slot.state === 'idle') || createSpeechAudioSlot();
}

function releaseSpeechAudioSlot(slot: SpeechAudioSlot): void {
  const player = slot.audio;
  player.onloadeddata = null;
  player.onplaying = null;
  player.onended = null;
  player.onerror = null;
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (slot.objectUrl) URL.revokeObjectURL(slot.objectUrl);
  slot.objectUrl = null;
  slot.state = 'idle';
  if (activeAudioSlot === slot) activeAudioSlot = null;
}

function prepareSpeechAudio(blob: Blob, generation: number): Promise<void> {
  if (typeof Audio === 'undefined') return Promise.resolve();
  const existing = preparedAudioByBlob.get(blob);
  if (existing?.state === 'prepared') return Promise.resolve();
  const slot = idleSpeechAudioSlot();
  if (!slot) return Promise.resolve();

  const player = slot.audio;
  const objectUrl = URL.createObjectURL(blob);
  slot.objectUrl = objectUrl;
  slot.state = 'preparing';

  return new Promise(resolve => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (failed = false) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      player.onloadeddata = null;
      player.onerror = null;
      if (generation !== prefetchGeneration || slot.objectUrl !== objectUrl || slot.state !== 'preparing') {
        resolve();
        return;
      }
      if (failed) {
        releaseSpeechAudioSlot(slot);
      } else {
        slot.state = 'prepared';
        preparedAudioByBlob.set(blob, slot);
      }
      resolve();
    };

    player.onloadeddata = () => finish();
    player.onerror = () => finish(true);
    try {
      player.src = objectUrl;
      player.load();
      if (player.readyState >= 2) finish();
      else if (!settled) timeout = setTimeout(() => finish(), 1500);
    } catch {
      finish(true);
    }
  });
}

// Both neural voices return a WAV, and each one opens the sentence with a breath and closes it
// with a beat of silence of its own. Left in place those read as a hesitation before the first
// word and a long pause after the full stop, so both go before the clip is queued. A clip that
// cannot be read is played as it came.
export async function trimSpeechSilence(blob: Blob): Promise<Blob> {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const trimmed = trimSilenceWav(bytes);
    if (trimmed === bytes) return blob;
    return new Blob([trimmed as unknown as BlobPart], { type: blob.type || 'audio/wav' });
  } catch {
    return blob;
  }
}

export function primeSpeechAudio(): void {
  if (typeof Audio === 'undefined') return;
  const silence = silentWavDataUri();
  while (audioSlots.length < 3) createSpeechAudioSlot();
  for (const slot of audioSlots) {
    if (slot.state !== 'idle') continue;
    slot.audio.onloadeddata = null;
    slot.audio.onplaying = null;
    slot.audio.onended = null;
    slot.audio.onerror = null;
    slot.audio.src = silence;
    void slot.audio.play().catch(() => {});
  }
}

export function prefetchSpeechAudio(key: string, render: () => Promise<Blob>): void {
  if (!key || prefetched.some(entry => entry.key === key)) return;
  const generation = prefetchGeneration;
  const job = render().then(async blob => {
    if (generation === prefetchGeneration) await prepareSpeechAudio(blob, generation);
    return blob;
  });
  // A prefetch nobody waits for must not surface as an unhandled rejection
  job.catch(() => {});
  prefetched.push({ key, audio: job });
  // Reading on past a sentence leaves its prefetch behind; the farthest future clip is dropped
  while (prefetched.length > PREFETCH_AHEAD) prefetched.pop();
}

export function takePrefetchedSpeechAudio(key: string): Promise<Blob> | null {
  const at = prefetched.findIndex(entry => entry.key === key);
  if (at === -1) return null;
  const [entry] = prefetched.splice(at, 1);
  return entry.audio;
}

export function playSpeechAudio(blob: Blob, rate: number, handlers: PlayHandlers): void {
  let slot: SpeechAudioSlot | null | undefined = preparedAudioByBlob.get(blob);
  const wasPrepared = Boolean(slot && slot.state === 'prepared');
  if (!wasPrepared) slot = idleSpeechAudioSlot();
  if (!slot) {
    handlers.onError(new Error('No audio player is available.'));
    return;
  }
  preparedAudioByBlob.delete(blob);

  const player = slot.audio;
  if (!wasPrepared) {
    slot.objectUrl = URL.createObjectURL(blob);
    player.src = slot.objectUrl;
  }
  slot.state = 'playing';
  activeAudioSlot = slot;
  player.playbackRate = rate;
  loaded = true;

  let failed = false;
  const fail = (reason?: unknown) => {
    if (failed) return;
    failed = true;
    loaded = false;
    releaseSpeechAudioSlot(slot);
    handlers.onError(reason);
  };

  player.onplaying = null;
  player.onended = () => {
    loaded = false;
    releaseSpeechAudioSlot(slot);
    handlers.onEnded();
  };
  player.onerror = () => fail();
  void player.play().catch(fail);
}

// True when a sentence was paused mid-flight and is picked up where it stopped
export function resumeSpeechAudio(onLost: () => void): boolean {
  const slot = activeAudioSlot;
  if (!loaded || !slot?.audio.src) return false;
  void slot.audio.play().catch(() => {
    if (activeAudioSlot !== slot) return;
    loaded = false;
    releaseSpeechAudioSlot(slot);
    onLost();
  });
  return true;
}

export function pauseSpeechAudio(): boolean {
  if (!loaded || !activeAudioSlot?.audio.src) return false;
  activeAudioSlot.audio.pause();
  return true;
}

export function stopSpeechAudio(): void {
  prefetched = [];
  prefetchGeneration += 1;
  preparedAudioByBlob = new WeakMap<Blob, SpeechAudioSlot>();
  loaded = false;
  activeAudioSlot = null;
  for (const slot of audioSlots) releaseSpeechAudioSlot(slot);
}
