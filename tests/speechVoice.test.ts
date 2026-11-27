// Speech audio helpers and the downloaded-voice catalogue are pure, so both are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pcm16ToWavBytes, silentWavDataUri, trimSilenceWav } from '../lib/wav.ts';
import { PIPER_DEFAULT_VOICE_ID, PIPER_VOICES, findPiperVoice, piperDownloadMb } from '../lib/piperVoices.ts';
import { carrySpeechFallback, piperStatusLabel } from '../lib/readAloud.ts';

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

test('the silent clip that unlocks iOS audio is a valid WAV', () => {
  const uri = silentWavDataUri();
  assert.match(uri, /^data:audio\/wav;base64,/);
  const binary = atob(uri.split(',')[1]);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
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

test('a piece that follows a refused one stays on the device voice for the rest of the run', () => {
  // A refusal earlier in the run carries over, whatever the chosen voice was
  assert.equal(carrySpeechFallback(true, 'piper', true), true);
  // A fresh start retries the chosen voice; only a missing download steps aside
  assert.equal(carrySpeechFallback(false, 'device', true), false);
  assert.equal(carrySpeechFallback(false, 'piper', false), true);
  assert.equal(carrySpeechFallback(false, 'piper', true), false);
});

