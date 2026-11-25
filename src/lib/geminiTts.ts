// Gemini speech goes through Curator's own server route, so the key is handled exactly as it
// is for the digest: the reader's key when they have one, the server's otherwise.
import { speechAudioBlob } from '../../lib/wav';

export interface GeminiSpeechVoice {
  name: string;
  character: string;
}

// The prebuilt voices that suit reading an article aloud: even, clear, informative or warm.
// The excitable and youthful ones are left out, because a news piece read cheerfully is worse
// than the device voice it replaces.
export const GEMINI_TTS_VOICES: GeminiSpeechVoice[] = [
  { name: 'Kore', character: 'firm' },
  { name: 'Charon', character: 'informative' },
  { name: 'Schedar', character: 'even' },
  { name: 'Iapetus', character: 'clear' },
  { name: 'Sulafat', character: 'warm' },
  { name: 'Aoede', character: 'breezy' },
];

export const GEMINI_TTS_DEFAULT_VOICE = GEMINI_TTS_VOICES[0].name;

// Google reports a refused sentence as a JSON blob inside the message, and a host that has no
// speech route at all answers with a page of HTML. Both become one sentence a reader can act
// on, because "could not speak that passage" on its own says nothing about what to fix.
const googleMessage = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message || parsed?.message || '').trim();
  } catch {
    return text;
  }
};

export function speechFailureMessage(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === 'object' && error !== null) {
    const nested = googleMessage((error as { message?: unknown }).message);
    if (nested) return nested;
  }
  const described = googleMessage(error);
  if (described) return described;
  if (status === 404) return 'This server has no speech endpoint — the build serving it is older than the voice.';
  if (status === 401 || status === 403) return `Google refused the key (${status}). Check it has the speech model enabled.`;
  if (status === 429) return 'Google is limiting this key right now (429). Wait a moment and carry on.';
  if (status >= 500) return `The speech service returned an unusable server error (${status}).`;
  if (status >= 200 && status < 300) return 'The server answered with no audio — the voice may be unavailable just now.';
  return `The server answered ${status} without any audio.`;
}

export interface GeminiSpeechRequest {
  text: string;
  voice: string;
  apiKey?: string;
  signal?: AbortSignal;
}

export async function synthesizeGeminiSpeech({ text, voice, apiKey, signal }: GeminiSpeechRequest): Promise<Blob> {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, apiKey: apiKey || '' }),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.audio) {
    throw new Error(speechFailureMessage(response.status, data));
  }
  return speechAudioBlob(String(data.audio), String(data.mimeType || 'audio/wav'));
}
