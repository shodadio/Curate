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

export const SPEECH_ENGINE_STORAGE_KEY = 'curator_speech_engine';
export const SPEECH_PIPER_VOICE_STORAGE_KEY = 'curator_speech_piper_voice';
export const SPEECH_GEMINI_VOICE_STORAGE_KEY = 'curator_speech_gemini_voice';

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
