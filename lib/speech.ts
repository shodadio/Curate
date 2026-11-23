// Read-aloud preparation: what the voice is asked to say, which is not the same as what the
// page shows. Kept out of the screen so the wording, the voice choice and the sentence split
// can be tested — and changed — without touching a seven-thousand-line component.

import { decodeEntities, stripMarkdownEmphasis } from './markup.ts';

// Browsers cut a long utterance off (Chrome after roughly fifteen seconds, iOS stalls), so the
// reader speaks a sentence at a time: 220 characters sits inside every engine's comfort zone.
export const SPEECH_MAX_CHUNK_CHARS = 220;

export const SPEECH_VOICE_AUTO = 'auto';
export const SPEECH_VOICE_JAMIE_DEFAULT = 'default-jamie-premium';

// Jamie (Premium) is the default read-aloud voice. Only some browsers put the quality in
// the name, so the preference order also helps identify the best voice when variants tie.
const PREFERRED_SPEECH_VOICES = [
  'jamie', 'evan', 'ava', 'zoe', 'allison', 'nathan', 'samantha', 'daniel',
  'serena', 'karen', 'oliver', 'martha', 'arthur', 'moira', 'tessa', 'rishi'
];

// "Jamie (Premium)" and "Jamie" are the same voice to a reader choosing one
function speechVoiceBaseName(voice: SpeechSynthesisVoice): string {
  return (voice.name || '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()
    .toLowerCase();
}

// How good a voice is likely to sound. Some platforms name the quality outright and some
// only hint at it, so this combines the reader's preference order with what the name says.
function speechVoiceQuality(voice: SpeechSynthesisVoice): number {
  const base = speechVoiceBaseName(voice);
  const raw = (voice.name || '').toLowerCase();
  let value = 0;
  const rank = PREFERRED_SPEECH_VOICES.indexOf(base);
  if (rank !== -1) value += (PREFERRED_SPEECH_VOICES.length - rank) * 10;
  if (/(enhanced|premium|neural|natural)/.test(raw)) value += 45;
  if (voice.localService) value += 6;
  if (voice.default) value += 4;
  return value;
}

export function resolveSpeechVoice(
  voices: SpeechSynthesisVoice[],
  preference: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null;

  // Speak the language the reader is reading in: the interface is English throughout
  const english = voices.filter(voice => /^en(-|_|$)/i.test(voice.lang || ''));
  const pool = english.length > 0 ? english : voices;

  if (preference === SPEECH_VOICE_JAMIE_DEFAULT) {
    const jamiePremium = pool
      .filter(voice => speechVoiceBaseName(voice) === 'jamie' && /premium/i.test(voice.name || ''))
      .sort((a, b) => speechVoiceQuality(b) - speechVoiceQuality(a));
    return jamiePremium[0] || null;
  }

  if (preference && preference !== SPEECH_VOICE_AUTO) {
    const chosen =
      voices.find(voice => voice.voiceURI === preference) ||
      voices.find(voice => voice.name === preference) ||
      // A voice saved by an older build can return under a new URI after an OS update, so the
      // English pool is also searched by URI, by name, and by the voice name inside a legacy
      // full URI such as com.apple.voice.premium.en-US.Jamie.
      pool.find(voice => voice.voiceURI === preference || voice.name === preference) ||
      pool.find(voice => speechVoiceBaseName(voice) === preference.toLowerCase()) ||
      pool.find(voice => preference.toLowerCase().includes(speechVoiceBaseName(voice)));
    return chosen || null;
  }

  // Automatic only speaks with a voice whose name says outright that it is a good one.
  // iOS does not list the Enhanced and Premium voices chosen in Spoken Content, and forcing
  // a compact voice from the short list it does expose would replace the good one with it —
  // so with nothing better to pick, the choice is left to the device.
  const marked = pool.filter(voice => /(enhanced|premium|neural|natural)/i.test(voice.name || ''));
  if (marked.length === 0) return null;

  return marked.slice().sort((a, b) => speechVoiceQuality(b) - speechVoiceQuality(a))[0] || null;
}

// Sound-effect and joke voices iOS ships (Zarvox, Bahh, Bells…) never suit reading news;
// the picker only offers real speech voices.
const NOVELTY_SPEECH_VOICE_NAMES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'bungler', 'cello',
  'deranged', 'good news', 'grandma', 'grandpa', 'hysterical', 'jester', 'organ',
  'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox'
]);

// One entry per voice, not one per installed variant: some devices report "Daniel" twice
// (compact and Enhanced) under the same name, and a picker listing both is a trap
export function speechVoiceChoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const english = voices.filter(voice => /^en(-|_|$)/i.test(voice.lang || ''));
  const englishPool = english.length > 0 ? english : voices;
  const pool = englishPool.filter(voice => !NOVELTY_SPEECH_VOICE_NAMES.has(speechVoiceBaseName(voice)));
  const best = new Map<string, SpeechSynthesisVoice>();
  for (const voice of pool) {
    const key = `${speechVoiceBaseName(voice)}|${(voice.lang || '').toLowerCase()}`;
    const kept = best.get(key);
    if (!kept || speechVoiceQuality(voice) > speechVoiceQuality(kept)) best.set(key, voice);
  }
  return [...best.values()].sort((a, b) => speechVoiceBaseName(a).localeCompare(speechVoiceBaseName(b)));
}

// Feed bodies carry URLs, footnote marks and site furniture. Left alone, the voice reads
// addresses out one character at a time, which is the quickest way to make it sound cheap.
export function normaliseForSpeech(text: string): string {
  if (!text) return '';

  let out = decodeEntities(text)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // Figures are images and captions, not part of the article's spoken copy.
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure\s*>/gi, ' ')
    .replace(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption\s*>/gi, ' ')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\u00a0/g, ' ');

  // Drop image markup and its caption; keep the useful label of ordinary text links.
  out = out
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/!\[[^\]]*\](?:\[[^\]]*\])?/g, ' ')
    // Remove Markdown footnote references before ordinary link labels are kept.
    .replace(/^\s*\[\^[^\]]+\]:.*$/gm, ' ')
    .replace(/\[\^[^\]]+\](?:\s*\([^)]*\))?/g, ' ')
    .replace(/\[\d+\](?:\s*\([^)]*\))?/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ');

  // A space inside "1. 79", "74, 000", "U. S." or "e. g." makes the engine stumble.
  out = out
    .replace(/(\d)([.,])\s+(\d)/g, '$1$2$3')
    .replace(/\b(?:[A-Za-z]\.\s+){1,}[A-Za-z]\./g, run => run.replace(/\s+/g, ''));

  const stripUrlKeepingPunctuation = (match: string) => {
    const url = match.replace(/[.,!?;:)\]}]+$/g, '');
    return ` ${match.slice(url.length)}`;
  };
  out = out
    .replace(/\b(?:https?:\/\/|ftp:\/\/|mailto:|www\.)[^\s<>{}]+/gi, stripUrlKeepingPunctuation)
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gi, ' ')
    // Recognise ordinary multi-label domains with any alphabetic TLD, not just a short allowlist.
    .replace(/\b(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s<>{}]*)?/gi, stripUrlKeepingPunctuation);

  // What a stripped address leaves behind is not words: "& url=", "sql=", "#/data/scores?_size=2".
  // Spoken aloud that is gibberish — worse than the address it came from — so it goes as well,
  // together with the punctuation it strands ("Demo of the bug: - click next").
  out = out
    .replace(/\b[a-z_][a-z0-9_]*=\S*/gi, ' ')
    .replace(/(?:^|\s)#\/\S*/g, ' ')
    .replace(/\b\S*(?:\/\S*){2,}/g, ' ')
    .replace(/%[\dA-F]{2}/gi, ' ')
    .replace(/:\s*[-–—]\s*/g, ', ')
    // An address that ended a clause leaves its preposition dangling ("The demo lives at, and
    // it explains…"); "a link" keeps the sentence speakable instead of a hole.
    .replace(/\b(at|on|in|into|from|via|through|under|using)\s*(?=[,.;:!?])/gi, '$1 a link')
    // Two addresses in a row use up the object of their verb: "See https://a and https://b for
    // the demos" would otherwise be spoken as "See and for the demos".
    .replace(/\b(see|visit|open|check|try|read)\s+and\s+(?=(?:for|to|in|on|at|with|from)\b)/gi, '$1 the links ');

  // Footnote references, superscripts, editorial bracket asides and placeholder ellipses.
  out = out
    .replace(/^\s*\[\^[^\]]+\]:.*$/gm, ' ')
    .replace(/\[\^?\d+\](?:\s*\([^)]*\))?/g, ' ')
    .replace(/\(\s*(?:\.{2,}|…+)\s*\)/g, ' ')
    .replace(/[\u00B9\u00B2\u00B3\u2020\u2021\u2070-\u209C]/g, ' ')
    // Strip any remaining square-bracket aside, including [...] and [citation text].
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ');

  // Remove caption-style lines and common subscription / article furniture wherever it is embedded.
  out = out
    .replace(/^\s*(?:image|photo|photograph|caption|image caption|figure)\s*:\s*[^\n]*(?:\n|$)/gim, ' ')
    .replace(/\(\s*(?:image|photo|photograph|caption|figure)\s*:[^)]*\)/gi, ' ')
    .replace(/(^|[.!?]\s+)(?:click here|tap here|read more|continue reading|share this|advertisement)\b[^.!?\n]*(?:[.!?]|$)/gim, '$1 ')
    .replace(/\b(?:click|tap) here\b/gi, ' ')
    .replace(/\bread\s+(?:the\s+)?(?:full|original|rest\s+of\s+(?:the|this))\s+(?:article|post|story)\b[^.!?]*[.!?]?/gi, ' ')
    .replace(/\b(?:read more|continue reading|share this|advertisement)\b/gi, ' ');

  // Remove Markdown formatting while retaining the words it decorates. Emphasis comes off
  // the same way it does on screen, so the voice reads what the eye saw.
  out = stripMarkdownEmphasis(out
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-+*•·]\s+/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/```[^\n]*|```/g, ' ')
    .replace(/~~/g, ' ')
    .replace(/\|/g, ' '));

  // Abbreviations, numbers, symbols and currency the engine otherwise spells awkwardly.
  const currencyNames: Record<string, string> = {
    USD: 'US dollars', CAD: 'Canadian dollars', AUD: 'Australian dollars', NZD: 'New Zealand dollars',
    GBP: 'pounds', EUR: 'euros', JPY: 'yen', CNY: 'yuan', INR: 'rupees', KRW: 'won', RUB: 'rubles'
  };
  out = out
    .replace(/\be\s*\.\s*g\s*\.(?:\s*,)?\s*/gi, 'for example, ')
    .replace(/\bi\s*\.\s*e\s*\.(?:\s*,)?\s*/gi, 'that is, ')
    .replace(/\betc\.?(?=\s|$|[,;:!?])/gi, 'et cetera')
    .replace(/\bvs\.?(?=\s|$|[,;:!?])/gi, 'versus')
    .replace(/\bw\s*\/\s*o\b/gi, 'without')
    .replace(/\bw\s*\/\s*/gi, 'with ')
    .replace(/\bDr\.?(?=\s|$)/gi, 'Doctor')
    .replace(/\bMr\.?(?=\s|$)/gi, 'Mister')
    .replace(/\bMrs\.?(?=\s|$)/gi, 'Missus')
    .replace(/\bMs\.?(?=\s|$)/gi, 'Miz')
    .replace(/\bNo\.\s*(\d)/gi, 'Number $1')
    .replace(/\b(US|CA|AU|NZ)\$\s*(\d[\d,]*(?:\.\d+)?)/gi, (_match, region: string, amount: string) => {
      const name = currencyNames[`${region.toUpperCase()}D`];
      return `${amount} ${name}`;
    })
    .replace(/\b([\d][\d,]*(?:\.\d+)?)\s*(USD|CAD|AUD|NZD|GBP|EUR|JPY|CNY|INR|KRW|RUB)\b/gi, (_match, amount: string, code: string) => `${amount} ${currencyNames[code.toUpperCase()]}`)
    .replace(/\b(USD|CAD|AUD|NZD|GBP|EUR|JPY|CNY|INR|KRW|RUB)\s*(\d[\d,]*(?:\.\d+)?)/gi, (_match, code: string, amount: string) => `${amount} ${currencyNames[code.toUpperCase()]}`)
    .replace(/\$\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 dollars')
    .replace(/£\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 pounds')
    .replace(/€\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 euros')
    .replace(/¥\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 yen')
    .replace(/₹\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 rupees')
    .replace(/₩\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 won')
    .replace(/₽\s*(\d[\d,]*(?:\.\d+)?)/g, '$1 rubles')
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*%/g, '$1 percent')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent')
    .replace(/×/g, ' by ')
    .replace(/→/g, ' to ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, ', ');

  return out
    // Quotation marks are punctuation for the eye; some engines read them out as "quote",
    // and the marks a scraper strands in the middle of a sentence only add pauses.
    .replace(/["“”„‟]/g, '')
    .replace(/\s+/g, ' ')
    // A stripped link can leave a run of punctuation behind; one mark says as much as four.
    .replace(/([,.;:!?])(?:\s*[,.;:!?])+/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/([a-z]{2}[.!?])(?=[A-Z])/g, '$1 ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:.]+/, '')
    // An address can take a whole clause with it, leaving "and and" where links used to be.
    .replace(/^(?:(?:and|or)\s*)+$/i, '')
    .trim();
}

export function splitIntoSentences(text: string): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const segments: string[] = [];
  const boundary = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(clean)) !== null) {
    const end = match.index + match[0].length;
    const candidate = clean.slice(cursor, end).trim();
    // "U.S." and "e.g." end in a full stop that is not the end of a sentence
    if (/(?:[A-Za-z]\.){2,}$/.test(candidate)) {
      boundary.lastIndex = end;
      continue;
    }
    segments.push(candidate);
    cursor = end;
    while (clean[cursor] === ' ') cursor += 1;
    boundary.lastIndex = cursor;
  }
  if (cursor < clean.length) segments.push(clean.slice(cursor).trim());

  const sentences: string[] = [];
  for (const segment of segments) {
    if (!segment) continue;
    let rest = segment;
    // A run-on with no full stop is broken at the last clause that still fits
    while (rest.length > SPEECH_MAX_CHUNK_CHARS) {
      const head = rest.slice(0, SPEECH_MAX_CHUNK_CHARS);
      const clause = Math.max(
        head.lastIndexOf(', '),
        head.lastIndexOf('; '),
        head.lastIndexOf(': '),
        head.lastIndexOf(' ')
      );
      const cut = clause > 60 ? clause + 1 : SPEECH_MAX_CHUNK_CHARS;
      sentences.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) sentences.push(rest);
  }

  return sentences;
}
