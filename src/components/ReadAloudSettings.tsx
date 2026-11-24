// Read aloud, in Settings: which voice speaks, and how fast. The reading itself belongs to the
// reader; this panel only reports the choice and asks for the two things a better voice needs —
// a download, or a key.
import { Volume2 } from 'lucide-react';
import { SettingsSection } from './SettingsSection';
import { GEMINI_TTS_VOICES } from '../lib/geminiTts';
import {
  PIPER_RUNTIME_DOWNLOAD_MB,
  PIPER_VOICES,
  findPiperVoice,
  piperDownloadMb,
} from '../../lib/piperVoices';
import {
  SPEECH_RATE_MAX,
  SPEECH_RATE_MIN,
  piperStatusLabel,
  type PiperDownloadState,
  type SpeechEngine,
} from '../../lib/readAloud';
import { SPEECH_VOICE_AUTO, SPEECH_VOICE_JAMIE_DEFAULT } from '../../lib/speech';

const ENGINE_OPTIONS: Array<{ id: SpeechEngine; label: string; note: string }> = [
  {
    id: 'device',
    label: 'This device',
    note: 'Instant and free, but the voice is whatever this device installed — often the robotic one.',
  },
  {
    id: 'piper',
    label: 'Downloaded',
    note: 'A neural voice kept on this device. One download, then no connection needed.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    note: 'The best voice here, but each sentence comes from Google over the network and costs a little.',
  },
];

const SELECT_CLASS =
  'w-full bg-[#f6f1e7] border border-[#ddd2bc] rounded-xl px-3 py-2 text-xs text-[#3f3a33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a5a24]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f6f1e7] focus:border-[#8a5a24] cursor-pointer';

export interface ReadAloudSettingsProps {
  engine: SpeechEngine;
  onEngineChange: (engine: SpeechEngine) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  deviceVoiceUri: string;
  onDeviceVoiceChange: (uri: string) => void;
  deviceVoices: SpeechSynthesisVoice[];
  automaticVoice: SpeechSynthesisVoice | null;
  jamieVoice: SpeechSynthesisVoice | null;
  piperVoiceId: string;
  onPiperVoiceChange: (id: string) => void;
  piperState: PiperDownloadState;
  onPiperDownload: () => void;
  onPiperRemove: () => void;
  geminiVoice: string;
  onGeminiVoiceChange: (voice: string) => void;
  geminiReady: boolean;
  onPreview: () => void;
}

export function ReadAloudSettings({
  engine,
  onEngineChange,
  rate,
  onRateChange,
  deviceVoiceUri,
  onDeviceVoiceChange,
  deviceVoices,
  automaticVoice,
  jamieVoice,
  piperVoiceId,
  onPiperVoiceChange,
  piperState,
  onPiperDownload,
  onPiperRemove,
  geminiVoice,
  onGeminiVoiceChange,
  geminiReady,
  onPreview,
}: ReadAloudSettingsProps) {
  const piperVoice = findPiperVoice(piperVoiceId);
  const busy = piperState.status === 'downloading' || piperState.status === 'checking';

  return (
    <SettingsSection
      icon={<Volume2 className="w-4 h-4" />}
      title="Read aloud"
      meta={`${rate.toFixed(2)}×`}
    >
      <div>
        <label className="block text-xs font-medium text-[#3f3a33] mb-1.5">Voice engine</label>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Read aloud voice engine">
          {ENGINE_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={engine === option.id}
              onClick={() => onEngineChange(option.id)}
              className={`px-2 py-1.5 text-xs rounded-xl border transition ${
                engine === option.id
                  ? 'border-[#1c1a17] bg-[#1c1a17]/10 text-[#1c1a17] font-semibold'
                  : 'border-[#c9bc9f] bg-transparent text-[#3f3a33] hover:border-[#1c1a17] hover:text-[#1c1a17]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[#6f675c] mt-1 leading-relaxed">
          {ENGINE_OPTIONS.find(option => option.id === engine)?.note}
        </p>
      </div>

      {engine === 'device' && (
        <div>
          <label className="block text-xs font-medium text-[#3f3a33] mb-1.5">Voice</label>
          <select value={deviceVoiceUri} onChange={event => onDeviceVoiceChange(event.target.value)} className={SELECT_CLASS}>
            <option value={SPEECH_VOICE_JAMIE_DEFAULT}>
              Jamie (Premium){jamieVoice?.lang ? ` · ${jamieVoice.lang}` : ''} — default
            </option>
            <option value={SPEECH_VOICE_AUTO}>
              {automaticVoice ? `Automatic — ${automaticVoice.name}` : 'Automatic — your device voice'}
            </option>
            {deviceVoices
              .filter(voice => voice.voiceURI !== jamieVoice?.voiceURI)
              .map(voice => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} · {voice.lang}
                </option>
              ))}
          </select>
          <p className="text-xs text-[#6f675c] mt-1">
            {deviceVoices.length > 0
              ? `${deviceVoices.length} ${deviceVoices.length === 1 ? 'voice' : 'voices'} on this device`
              : 'Start Read aloud once to load this device’s voices.'}
          </p>
        </div>
      )}

      {engine === 'piper' && (
        <div className="space-y-2 rounded-xl border border-[#ddd2bc] bg-[#f6f1e7] px-3 py-2">
          <div>
            <label className="block text-xs font-medium text-[#3f3a33] mb-1.5">Downloaded voice</label>
            <select value={piperVoiceId} onChange={event => onPiperVoiceChange(event.target.value)} className={SELECT_CLASS}>
              {PIPER_VOICES.map(voice => (
                <option key={voice.id} value={voice.id}>
                  {voice.label} — {voice.accent} · {voice.sizeMb} MB
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-[#6f675c] leading-relaxed">
            {piperVoice.label} is about {piperDownloadMb(piperVoice)} MB once: {piperVoice.sizeMb} MB of voice and roughly{' '}
            {PIPER_RUNTIME_DOWNLOAD_MB} MB of speech engine the browser keeps afterwards. Expect a few seconds on a good
            connection, and it stays on this device — after that, reading aloud needs no connection at all.
          </p>
          <p className="text-xs text-[#6f675c] leading-relaxed">
            On a phone the first download is slower, and a low-memory phone can take a second or two per sentence or
            give up: when it does, this device’s voice reads that passage instead. Voice licence: {piperVoice.licence}.
          </p>

          <p role="status" aria-live="polite" className="text-xs text-[#1c1a17] leading-relaxed">
            {piperStatusLabel(piperState, piperVoice)}
          </p>

          <div className="flex flex-wrap gap-2">
            {piperState.status === 'ready' ? (
              <button
                type="button"
                onClick={onPiperRemove}
                className="px-3 py-1.5 text-xs font-medium rounded-xl bg-transparent border border-[#c9bc9f] text-[#3f3a33] hover:border-[#1c1a17] hover:text-[#1c1a17] transition"
              >
                Remove from this device
              </button>
            ) : (
              <button
                type="button"
                onClick={onPiperDownload}
                disabled={busy || piperState.status === 'unsupported'}
                className="px-3 py-1.5 text-xs font-medium rounded-xl bg-[#1c1a17] text-[#f6f1e7] hover:bg-[#3f3a33] disabled:opacity-50 transition"
              >
                {piperState.status === 'downloading'
                  ? `Downloading ${Math.round(piperState.progress * 100)}%`
                  : `Download ${piperVoice.label}`}
              </button>
            )}
          </div>
        </div>
      )}

      {engine === 'gemini' && (
        <div className="space-y-2 rounded-xl border border-[#ddd2bc] bg-[#f6f1e7] px-3 py-2">
          <div>
            <label className="block text-xs font-medium text-[#3f3a33] mb-1.5">Gemini voice</label>
            <select value={geminiVoice} onChange={event => onGeminiVoiceChange(event.target.value)} className={SELECT_CLASS}>
              {GEMINI_TTS_VOICES.map(voice => (
                <option key={voice.name} value={voice.name}>
                  {voice.name} — {voice.character}
                </option>
              ))}
            </select>
          </div>

          <p className="text-xs text-[#6f675c] leading-relaxed">
            Google’s speech model reads each sentence through Curator’s own server: about a penny a minute of listening,
            and every sentence needs a connection. Nothing is downloaded to this device.
          </p>
          <p className={`text-xs leading-relaxed ${geminiReady ? 'text-[#6f675c]' : 'text-[#1c1a17] font-medium'}`}>
            {geminiReady
              ? 'A Gemini key is configured, so this voice is ready.'
              : 'Add a Gemini key under Connect an AI service first, or the device voice reads instead.'}
          </p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-[#3f3a33] mb-1.5 flex items-center justify-between">
          <span>Speed</span>
          <span className="text-[#1c1a17] tabular-nums">{rate.toFixed(2)}×</span>
        </label>
        <input
          type="range"
          min={SPEECH_RATE_MIN}
          max={SPEECH_RATE_MAX}
          step={0.05}
          value={rate}
          onChange={event => onRateChange(Number(event.target.value))}
          className="w-full accent-[#8a5a24]"
          aria-label="Read aloud speed"
        />
        <div className="flex justify-between text-xs text-[#6f675c]">
          <span>Slower</span>
          <span>Faster</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onPreview}
        className="px-4 py-2 text-xs font-medium rounded-xl bg-[#1c1a17]/10 border border-[#c9bc9f] text-[#1c1a17] hover:bg-[#1c1a17]/10 transition"
      >
        Hear this voice
      </button>
    </SettingsSection>
  );
}
