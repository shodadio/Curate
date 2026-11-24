// The two neural voices hand back audio in different containers, and the catalogue decides
// what can legally be downloaded. Both are pure, so both are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, pcm16ToWavBytes, silentWavDataUri, speechAudioBlob, trimTrailingSilenceWav } from '../lib/wav.ts';
import { PIPER_DEFAULT_VOICE_ID, PIPER_VOICES, findPiperVoice, piperDownloadMb } from '../lib/piperVoices.ts';
import { piperStatusLabel, resolveGeminiSpeechKey } from '../lib/readAloud.ts';
import { GEMINI_TTS_API_VERSION, geminiTtsRequest } from '../lib/geminiTtsRequest.ts';

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

test('raw speech PCM is wrapped in a playable WAV header', () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const wav = pcm16ToWavBytes(pcm, 24000, 1);
  const view = new DataView(wav.buffer);

  assert.equal(wav.byteLength, 48);
  assert.equal(ascii(wav, 0, 4), 'RIFF');
  assert.equal(ascii(wav, 8, 4), 'WAVE');
  assert.equal(ascii(wav, 36, 4), 'data');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 24000, '24 kHz');
  assert.equal(view.getUint32(40, true), 4, 'data size');
  assert.deepEqual([...wav.subarray(44)], [1, 2, 3, 4]);
});

test('a Gemini reply that is already WAV is played as it arrived', () => {
  const wav = pcm16ToWavBytes(new Uint8Array(8), 24000, 1);
  const blob = speechAudioBlob(bytesToBase64(wav), 'audio/wav');
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, wav.byteLength);
});

test('headerless Gemini PCM is converted rather than played as noise', () => {
  const blob = speechAudioBlob(bytesToBase64(new Uint8Array(6)), 'audio/L16;codec=pcm;rate=24000');
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, 50);
  assert.equal(base64ToBytes(bytesToBase64(new Uint8Array([9, 8]))).length, 2);
});

test('the silent clip that unlocks iOS audio is a valid WAV', () => {
  const uri = silentWavDataUri();
  assert.match(uri, /^data:audio\/wav;base64,/);
  const bytes = base64ToBytes(uri.split(',')[1]);
  assert.equal(ascii(bytes, 0, 4), 'RIFF');
  assert.ok(bytes.byteLength > 44);
});

// A clip shaped like a rendered sentence: `speechMs` of a tone, then `silenceMs` of nothing
const spokenClip = (speechMs: number, silenceMs: number, sampleRate = 24000) => {
  const pcm = new Uint8Array(((speechMs + silenceMs) * sampleRate * 2) / 1000);
  const view = new DataView(pcm.buffer);
  for (let sample = 0; sample < (speechMs * sampleRate) / 1000; sample += 1) {
    view.setInt16(sample * 2, sample % 2 ? 12000 : -12000, true);
  }
  return pcm16ToWavBytes(pcm, sampleRate, 1);
};

const wavSeconds = (wav: Uint8Array) =>
  new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(40, true) / 2 / 24000;

test('the silence a voice ends a sentence with is cut, keeping the word before it', () => {
  const trimmed = trimTrailingSilenceWav(spokenClip(400, 800));
  // 400 ms of speech plus a short tail, not the 800 ms the voice left behind
  assert.ok(wavSeconds(trimmed) > 0.44, `kept ${wavSeconds(trimmed)}s, too short to hold the word`);
  assert.ok(wavSeconds(trimmed) < 0.5, `kept ${wavSeconds(trimmed)}s, the silence survived`);
  assert.equal(ascii(trimmed, 0, 4), 'RIFF');
  const view = new DataView(trimmed.buffer, trimmed.byteOffset, trimmed.byteLength);
  assert.equal(view.getUint32(4, true), trimmed.byteLength - 8, 'RIFF size follows the shorter clip');
  assert.equal(view.getUint32(40, true), trimmed.byteLength - 44, 'data size follows the shorter clip');
});

test('a clip with no silence to spare is played untouched', () => {
  const clip = spokenClip(400, 0);
  assert.equal(trimTrailingSilenceWav(clip), clip);
  // Something that is not a WAV, and a clip that is silence all the way through, are left alone
  const silence = spokenClip(0, 600);
  assert.equal(trimTrailingSilenceWav(silence), silence);
  const noise = new Uint8Array(64).fill(7);
  assert.equal(trimTrailingSilenceWav(noise), noise);
});

test('every offered Piper voice may be downloaded and used commercially', () => {
  const ids = PIPER_VOICES.map(voice => voice.id);
  assert.equal(new Set(ids).size, ids.length, 'voice ids are unique');
  assert.ok(ids.includes(PIPER_DEFAULT_VOICE_ID));
  for (const voice of PIPER_VOICES) {
    assert.doesNotMatch(voice.licence, /non-?commercial|NC/i, `${voice.id} must be usable commercially`);
    assert.ok(voice.sizeMb > 0);
  }
  assert.equal(piperDownloadMb(findPiperVoice('en_GB-cori-medium')), 72);
  // A voice that is no longer offered falls back rather than leaving the picker empty
  assert.equal(findPiperVoice('de_DE-thorsten-low').id, PIPER_DEFAULT_VOICE_ID);
});

test('a downloaded voice says what it is doing, and what to do next', () => {
  const cori = findPiperVoice('en_GB-cori-medium');
  assert.equal(piperStatusLabel({ status: 'idle', progress: 0 }, cori).startsWith('Not downloaded yet'), true);
  assert.match(piperStatusLabel({ status: 'downloading', progress: 0.42 }, cori), /42%/);
  assert.match(piperStatusLabel({ status: 'ready', progress: 1 }, cori), /60 MB stored/);
  assert.match(piperStatusLabel({ status: 'unsupported', progress: 0 }, cori), /device voice is used/);
  // A failure shows the browser's own reason rather than a generic apology
  assert.equal(piperStatusLabel({ status: 'error', progress: 0, error: 'No space left' }, cori), 'No space left');
  assert.equal(piperStatusLabel({ status: 'error', progress: 0 }, cori), 'The download did not finish.');
});

test('reading aloud prefers its own Gemini key, then the digest’s, then the server’s', () => {
  const base = { readAloudKey: '', digestKey: '', digestProvider: 'deterministic', serverKeyAvailable: false };

  // A key typed for reading aloud wins even when another provider writes the digest
  assert.deepEqual(
    resolveGeminiSpeechKey({ ...base, readAloudKey: ' speech-key ', digestKey: 'digest-key', digestProvider: 'openai-compatible', serverKeyAvailable: true }),
    { key: 'speech-key', source: 'read-aloud' },
  );
  // With none of its own, the digest's Gemini key is reused rather than asking for a second one
  assert.deepEqual(
    resolveGeminiSpeechKey({ ...base, digestKey: 'digest-key', digestProvider: 'gemini' }),
    { key: 'digest-key', source: 'digest' },
  );
  // A Gemini key saved for an OpenAI-compatible digest is not silently sent to Gemini
  assert.deepEqual(
    resolveGeminiSpeechKey({ ...base, readAloudKey: '   ', digestKey: 'digest-key', digestProvider: 'openai-compatible' }),
    { key: '', source: 'none' },
  );
  // Nothing typed anywhere: the server's own key speaks, or there is none to speak with
  assert.deepEqual(resolveGeminiSpeechKey({ ...base, serverKeyAvailable: true }), { key: '', source: 'server' });
  assert.deepEqual(resolveGeminiSpeechKey(base), { key: '', source: 'none' });
});

test('Gemini 3.8 TTS uses v1beta and its single-speaker voice request shape', () => {
  assert.equal(GEMINI_TTS_API_VERSION, 'v1beta');
  assert.deepEqual(geminiTtsRequest('Read this sentence.', 'Kore', 'gemini-3.8-flash-lite-tts'), {
    model: 'gemini-3.8-flash-lite-tts',
    contents: [{ role: 'user', parts: [{ text: 'Read this sentence.' }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice: 'Kore' } },
    },
  });
});
