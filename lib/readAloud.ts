// Read-aloud choices that outlive a session: which engine speaks, which voice, and what to
// say about a downloaded voice. Kept apart from the screen so the wording can be tested.
import type { PiperVoice } from './piperVoices';

// The device's own voice, a voice downloaded once and kept on the device, or Gemini.
export type SpeechEngine = 'device' | 'piper' | 'gemini';

export type PiperDownloadStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'unsupported' | 'error';

export interface PiperDownloadState {
  status: PiperDownloadStatus;
  progress: number;
  error?: string;
}

// Just under normal pace, which is what a reader listening for ten minutes prefers
export const SPEECH_RATE_DEFAULT = 0.95;
export const SPEECH_RATE_MIN = 0.7;
export const SPEECH_RATE_MAX = 1.5;

// Where listening stopped in each piece, so reopening it carries on from the same sentence
// instead of the top. Kept by article id, pruned by age rather than by queue membership.
export const SPEECH_POSITION_STORAGE_KEY = 'curator_speech_position';
export const SPEECH_POSITION_LIMIT = 24;

export interface SpeechPosition {
  // The sentence to start from, and how many sentences the queue had when it was saved. A queue
  // of a different length means the text changed under it, and the top is then the honest start.
  index: number;
  total: number;
  // The rendered paragraph it belonged to, for putting the reader back where it was
  paragraph: number;
  at: number;
}

export type SpeechPositions = Record<string, SpeechPosition>;

export const SPEECH_ENGINE_STORAGE_KEY = 'curator_speech_engine';
export const SPEECH_PIPER_VOICE_STORAGE_KEY = 'curator_speech_piper_voice';
export const SPEECH_GEMINI_VOICE_STORAGE_KEY = 'curator_speech_gemini_voice';
export const SPEECH_GEMINI_KEY_STORAGE_KEY = 'curator_speech_gemini_key';

export type GeminiSpeechKeySource = 'read-aloud' | 'digest' | 'server' | 'none';

// Reading aloud may be given its own Gemini key, so a digest written by another provider does
// not leave the Gemini voice without one. The reader's own key wins, then the digest's Gemini
// key, then the server's. The browser sends a key; an empty one asks the server to use its own.
export function resolveGeminiSpeechKey(input: {
  readAloudKey: string;
  digestKey: string;
  digestProvider: string;
  serverKeyAvailable: boolean;
}): { key: string; source: GeminiSpeechKeySource } {
  const own = input.readAloudKey.trim();
  if (own) return { key: own, source: 'read-aloud' };

  const digest = input.digestKey.trim();
  if (digest && input.digestProvider === 'gemini') return { key: digest, source: 'digest' };

  return { key: '', source: input.serverKeyAvailable ? 'server' : 'none' };
}

// Whether the next piece starts on the device voice: the run already stepped aside from the
// chosen voice (it refused an earlier piece, and retrying a dead key at every article is the
// stutter that kept breaking the run), or the downloaded voice was never fetched. A fresh tap
// on Listen always retries the chosen voice, so a key fixed mid-run comes back on the next
// piece the reader starts themselves.
export function carrySpeechFallback(keepFallback: boolean, engine: SpeechEngine, piperReady: boolean): boolean {
  return keepFallback || (engine === 'piper' && !piperReady);
}

function validSpeechPosition(value: unknown): SpeechPosition | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<SpeechPosition>;
  const index = Number(entry.index);
  const total = Number(entry.total);
  const paragraph = Number(entry.paragraph);
  const at = Number(entry.at);
  if (!Number.isInteger(index) || !Number.isInteger(total) || !Number.isInteger(paragraph)) return null;
  if (!Number.isFinite(at)) return null;
  if (index < 0 || total <= 0 || index >= total || paragraph < -1) return null;
  return { index, total, paragraph, at };
}

// A stored map is only ever as trustworthy as the build that wrote it: anything malformed is
// dropped rather than allowed to send the voice to a sentence that no longer exists.
export function readSpeechPositions(raw: string | null): SpeechPositions {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const positions: SpeechPositions = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = validSpeechPosition(value);
    if (id && entry) positions[id] = entry;
  }
  return positions;
}

// Newest first when the map outgrows its limit, so the pieces being listened to now keep their
// place and the ones from a month ago lose it.
export function rememberSpeechPosition(
  positions: SpeechPositions,
  id: string,
  place: { index: number; total: number; paragraph: number; at?: number },
): SpeechPositions {
  if (!id) return positions;
  const entry = validSpeechPosition({ ...place, at: place.at ?? Date.now() });
  if (!entry) return positions;

  const next: SpeechPositions = { ...positions, [id]: entry };
  const ids = Object.keys(next);
  if (ids.length <= SPEECH_POSITION_LIMIT) return next;
  ids.sort((a, b) => next[b].at - next[a].at);
  for (const stale of ids.slice(SPEECH_POSITION_LIMIT)) delete next[stale];
  return next;
}

export function forgetSpeechPosition(positions: SpeechPositions, id: string): SpeechPositions {
  if (!positions[id]) return positions;
  const next = { ...positions };
  delete next[id];
  return next;
}

// The sentence to start from, or the top when there is nothing usable to resume.
export function resumeSpeechIndex(positions: SpeechPositions, id: string, total: number): number {
  const saved = positions[id];
  if (!saved || saved.total !== total) return 0;
  return saved.index > 0 && saved.index < total ? saved.index : 0;
}

// The pieces a listening run may continue into when one ends: the rest of the edition after it,
// then the ones before it, so a run started halfway through still covers the whole edition.
// Finished pieces are skipped and the piece that just ended never comes back.
export function nextUnreadPieces(
  orderedIds: string[],
  currentId: string,
  isFinished: (id: string) => boolean,
): string[] {
  const from = orderedIds.indexOf(currentId);
  if (from === -1) return [];
  return [...orderedIds.slice(from + 1), ...orderedIds.slice(0, from)]
    .filter(id => id !== currentId && !isFinished(id));
}

// What the reader is told about the downloaded voice, in every state it can be in.
export function piperStatusLabel(state: PiperDownloadState, voice: PiperVoice): string {
  switch (state.status) {
    case 'checking':
      return 'Checking this device…';
    case 'downloading':
      return `Downloading ${Math.round(state.progress * 100)}% — keep this page open.`;
    case 'ready':
      return `Ready on this device: ${voice.sizeMb} MB stored, so reading works with no connection.`;
    case 'unsupported':
      return 'This browser cannot keep a downloaded voice, so the device voice is used.';
    case 'error':
      return state.error || 'The download did not finish.';
    default:
      return 'Not downloaded yet — the device voice reads aloud until it is.';
  }
}
