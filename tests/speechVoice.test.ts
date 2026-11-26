// The two neural voices hand back audio in different containers, and the catalogue decides
// what can legally be downloaded. Both are pure, so both are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, bytesToBase64, pcm16ToWavBytes, silentWavDataUri, speechAudioBlob, trimSilenceWav } from '../lib/wav.ts';
import { PIPER_DEFAULT_VOICE_ID, PIPER_VOICES, findPiperVoice, piperDownloadMb } from '../lib/piperVoices.ts';
import { piperStatusLabel, resolveGeminiSpeechKey } from '../lib/readAloud.ts';
import { GEMINI_TTS_API_VERSION, describeGeminiTtsError, geminiTtsRequest } from '../lib/geminiTtsRequest.ts';
import { speechFailureMessage } from '../src/lib/geminiTts.ts';

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

test('a WAV that arrives labelled as PCM is still played as it arrived', () => {
  // Gemini 3.8 sends WAV where 3.1 sent headerless PCM, and the mime type has lagged behind
  const wav = pcm16ToWavBytes(new Uint8Array(8), 24000, 1);
  const blob = speechAudioBlob(bytesToBase64(wav), 'audio/L16;codec=pcm;rate=24000');
  assert.equal(blob.type, 'audio/wav');
  assert.equal(blob.size, wav.byteLength, 'a second header would make the clip unplayable');
});

test('a compressed clip is passed through rather than wrapped', () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
  const blob = speechAudioBlob(bytesToBase64(mp3), 'audio/mpeg');
  assert.equal(blob.type, 'audio/mpeg');
  assert.equal(blob.size, mp3.byteLength);
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

// A clip shaped like a rendered sentence: `leadMs` of nothing, `speechMs` of a tone, then
// `silenceMs` of nothing after it.
const spokenClip = (speechMs: number, silenceMs: number, leadMs = 0, sampleRate = 24000) => {
  const pcm = new Uint8Array(((leadMs + speechMs + silenceMs) * sampleRate * 2) / 1000);
  const view = new DataView(pcm.buffer);
  const leadSamples = Math.round((leadMs * sampleRate) / 1000);
  for (let sample = 0; sample < (speechMs * sampleRate) / 1000; sample += 1) {
    view.setInt16((leadSamples + sample) * 2, sample % 2 ? 12000 : -12000, true);
  }
  return pcm16ToWavBytes(pcm, sampleRate, 1);
};

const wavSeconds = (wav: Uint8Array) =>
  new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(40, true) / 2 / 24000;

// How far into a kept clip the voice first rises above the room
const firstSoundMs = (wav: Uint8Array) => {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const samples = view.getUint32(40, true) / 2;
  for (let sample = 0; sample < samples; sample += 1) {
    if (Math.abs(view.getInt16(44 + sample * 2, true)) >= 200) return (sample / 24000) * 1000;
  }
  return Infinity;
};

test('half of the silence a voice ends a sentence with is cut, keeping a short natural tail', () => {
  const trimmed = trimSilenceWav(spokenClip(400, 800));
  // 400 ms of speech plus a 30 ms tail, not the 800 ms the voice left behind
  assert.ok(wavSeconds(trimmed) > 0.42, `kept ${wavSeconds(trimmed)}s, too short to hold the word`);
  assert.ok(wavSeconds(trimmed) < 0.45, `kept ${wavSeconds(trimmed)}s, too much silence survived`);
  assert.equal(ascii(trimmed, 0, 4), 'RIFF');
  const view = new DataView(trimmed.buffer, trimmed.byteOffset, trimmed.byteLength);
  assert.equal(view.getUint32(4, true), trimmed.byteLength - 8, 'RIFF size follows the shorter clip');
  assert.equal(view.getUint32(40, true), trimmed.byteLength - 44, 'data size follows the shorter clip');
});

test('the breath a voice opens a sentence with is cut, keeping the first word', () => {
  const trimmed = trimSilenceWav(spokenClip(400, 0, 600));
  // The 600 ms of nothing in front is gone; a short head is kept so an opening consonant survives
  assert.ok(wavSeconds(trimmed) > 0.41, `kept ${wavSeconds(trimmed)}s, too short to hold the first word`);
  assert.ok(wavSeconds(trimmed) < 0.45, `kept ${wavSeconds(trimmed)}s, the breath survived`);
  assert.ok(firstSoundMs(trimmed) <= 30, `sound starts ${firstSoundMs(trimmed)}ms in, the breath is still there`);
});

test('a clip with no silence to spare is played untouched', () => {
  const clip = spokenClip(400, 0);
  assert.equal(trimSilenceWav(clip), clip);
  // Something that is not a WAV, and a clip that is silence all the way through, are left alone
  const silence = spokenClip(0, 600);
  assert.equal(trimSilenceWav(silence), silence);
  const noise = new Uint8Array(64).fill(7);
  assert.equal(trimSilenceWav(noise), noise);
});

test('a refused sentence says why it was refused', () => {
  // Google's refusal arrives as a JSON blob inside the error field
  const blob = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
  assert.equal(
    speechFailureMessage(502, { error: blob }),
    'API key not valid. Please pass a valid API key.',
  );
  assert.equal(speechFailureMessage(502, { error: 'Quota exceeded for this key.' }), 'Quota exceeded for this key.');

  // An older server forwarded the SDK's whole error with its status up front
  assert.equal(
    speechFailureMessage(502, { error: `503 ${blob}` }),
    'API key not valid. Please pass a valid API key.',
  );

  // A host with no speech route answers with a page, not a JSON error
  assert.match(speechFailureMessage(404, null), /no speech endpoint/);
  assert.match(speechFailureMessage(502, null), /unusable server error \(502\)/);
  assert.match(speechFailureMessage(429, null), /limiting this key/);
  assert.match(speechFailureMessage(200, { ok: true }), /answered with no audio/);
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

test('a Gemini refusal keeps its status and loses its JSON envelope', () => {
  // What the SDK throws for a bad key: status on the error, Google's body as the message
  const invalidKey = { status: 400, message: JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }) };
  assert.deepEqual(describeGeminiTtsError(invalidKey), {
    status: 400,
    message: 'API key not valid. Please pass a valid API key.',
  });
  // Some SDK builds lead the message with the status
  const overloaded = { status: 503, message: `503 ${JSON.stringify({ error: { code: 503, message: 'The model is overloaded.' } })}` };
  assert.deepEqual(describeGeminiTtsError(overloaded), { status: 503, message: 'The model is overloaded.' });
  // A transport failure never reached a status, but still says something
  assert.deepEqual(describeGeminiTtsError(new Error('Connection error.')), { status: 0, message: 'Connection error.' });
  assert.deepEqual(describeGeminiTtsError(null), { status: 0, message: 'Gemini could not speak that passage.' });
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
