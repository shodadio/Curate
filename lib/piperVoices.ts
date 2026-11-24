// The Piper voices this app offers. Only permissively licensed ones are listed: the wider
// catalogue also contains non-commercial voices, which an MIT app cannot ship or download
// for people to use.
export interface PiperVoice {
  id: string;
  label: string;
  accent: string;
  licence: string;
  sizeMb: number;
}

export const PIPER_VOICES: PiperVoice[] = [
  {
    id: 'en_GB-cori-medium',
    label: 'Cori',
    accent: 'British English, female',
    licence: 'public domain',
    sizeMb: 60,
  },
  {
    id: 'en_GB-alba-medium',
    label: 'Alba',
    accent: 'Scottish English, female',
    licence: 'CC BY 4.0',
    sizeMb: 60,
  },
];

export const PIPER_DEFAULT_VOICE_ID = PIPER_VOICES[0].id;

// The voice model is not the whole first load: the browser also fetches the speech runtime
// that turns text into phonemes and runs the model. It is kept afterwards, so this is paid once.
export const PIPER_RUNTIME_DOWNLOAD_MB = 12;

export function findPiperVoice(id: string): PiperVoice {
  return PIPER_VOICES.find(voice => voice.id === id) || PIPER_VOICES[0];
}

export function piperDownloadMb(voice: PiperVoice): number {
  return voice.sizeMb + PIPER_RUNTIME_DOWNLOAD_MB;
}
