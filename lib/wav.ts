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

// Safari only lets an audio element play later if it has played once inside the tap that
// started the reading. The queue opens with this instead of a blocked first sentence.
export function silentWavDataUri(ms = 30, sampleRate = 24000): string {
  const samples = Math.max(1, Math.round((sampleRate * ms) / 1000));
  const wav = pcm16ToWavBytes(new Uint8Array(samples * 2), sampleRate, 1);
  return `data:audio/wav;base64,${bytesToBase64(wav)}`;
}
