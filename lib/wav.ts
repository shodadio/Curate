// Audio is the one place the two neural voices disagree: Piper returns a WAV, and Gemini
// returns a WAV on current models but headerless 24 kHz PCM on older ones. Wrapping both
// here means the player never has to know which engine produced a sentence.

export function pcm16ToWavBytes(pcm: Uint8Array, sampleRate = 24000, channels = 1): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  const blockAlign = channels * 2;

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(header, 0);
  out.set(pcm, 44);
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a long article does not blow the argument limit of fromCharCode
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

// Whatever the engine sent back, the player gets something it can play.
export function speechAudioBlob(base64: string, mimeType: string): Blob {
  const bytes = base64ToBytes(base64);
  if (/wav|wave/i.test(mimeType || '')) {
    return new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' });
  }
  const sampleRate = Number(/rate=(\d+)/i.exec(mimeType || '')?.[1]) || 24000;
  const wav = pcm16ToWavBytes(bytes, sampleRate, 1);
  return new Blob([wav as unknown as BlobPart], { type: 'audio/wav' });
}

// A neural voice closes every sentence with a beat of near-silence of its own. Played back to
// back with the next clip that reads as a long pause after the full stop, far longer than the
// punctuation asks for, so each clip is cut back to just after its last audible sound. A short
// tail is kept after that sound: a word ending on a fricative decays for a few tens of
// milliseconds, and cutting on the last loud sample clips the word instead of the silence.
const TRIM_WINDOW_MS = 5;
const TRIM_TAIL_MS = 60;
// About 0.6% of full scale: below this a sample is the room, not the voice.
const TRIM_PEAK = 200;
// Cuts smaller than this are not worth rewriting the clip.
const TRIM_MIN_MS = 30;

const readAscii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

export function trimTrailingSilenceWav(wav: Uint8Array): Uint8Array {
  if (wav.byteLength < 44 || readAscii(wav, 0, 4) !== 'RIFF' || readAscii(wav, 8, 4) !== 'WAVE') return wav;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  // Anything that is not 16-bit PCM is left alone rather than guessed at
  let channels = 1;
  let sampleRate = 24000;
  let bits = 16;
  let dataStart = -1;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = readAscii(wav, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && offset + 24 <= wav.byteLength) {
      channels = view.getUint16(offset + 10, true) || 1;
      sampleRate = view.getUint32(offset + 12, true) || 24000;
      bits = view.getUint16(offset + 22, true) || 16;
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLength = Math.min(size, wav.byteLength - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0 || dataLength <= 0 || bits !== 16) return wav;

  const frame = channels * 2;
  const frames = Math.floor(dataLength / frame);
  if (frames <= 0) return wav;
  const windowFrames = Math.max(1, Math.round((sampleRate * TRIM_WINDOW_MS) / 1000));
  const tailFrames = Math.round((sampleRate * TRIM_TAIL_MS) / 1000);

  // The last window that still carries the voice, found from the end so the tail costs one pass
  let lastAudible = -1;
  for (let end = frames; end > 0; end -= windowFrames) {
    const start = Math.max(0, end - windowFrames);
    let peak = 0;
    for (let index = start; index < end && peak < TRIM_PEAK; index += 1) {
      const at = dataStart + index * frame;
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.abs(view.getInt16(at + channel * 2, true));
        if (sample > peak) peak = sample;
      }
    }
    if (peak >= TRIM_PEAK) {
      lastAudible = end;
      break;
    }
  }
  // A clip with nothing above the floor is silence through and through: leave it as it came
  if (lastAudible < 0) return wav;

  const keepFrames = Math.min(frames, lastAudible + tailFrames);
  const cutFrames = frames - keepFrames;
  if (cutFrames * 1000 < sampleRate * TRIM_MIN_MS) return wav;

  const keptBytes = keepFrames * frame;
  const tail = wav.subarray(dataStart + dataLength);
  const out = new Uint8Array(dataStart + keptBytes + tail.byteLength);
  out.set(wav.subarray(0, dataStart), 0);
  out.set(wav.subarray(dataStart, dataStart + keptBytes), dataStart);
  out.set(tail, dataStart + keptBytes);
  const outView = new DataView(out.buffer);
  outView.setUint32(4, out.byteLength - 8, true);
  outView.setUint32(dataStart - 4, keptBytes, true);
  return out;
}

// Safari only lets an audio element play later if it has played once inside the tap that
// started the reading. The queue opens with this instead of a blocked first sentence.
export function silentWavDataUri(ms = 30, sampleRate = 24000): string {
  const samples = Math.max(1, Math.round((sampleRate * ms) / 1000));
  const wav = pcm16ToWavBytes(new Uint8Array(samples * 2), sampleRate, 1);
  return `data:audio/wav;base64,${bytesToBase64(wav)}`;
}
