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
  const data = await response.json().catch(() => ({}) as any);
  if (!response.ok || !data?.audio) {
    throw new Error(String(data?.error || 'Gemini could not speak that passage.'));
  }
  return speechAudioBlob(String(data.audio), String(data.mimeType || 'audio/wav'));
}
