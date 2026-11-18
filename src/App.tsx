import React, { useState, useEffect } from 'react';
import { 
  Bookmark, Rss, RefreshCw, Check, CheckCheck, Plus, Trash2, 
  Download, Upload, Sliders, ExternalLink, ArrowLeft, Sparkles, 
  AlertCircle, X, Home, Compass,
  ThumbsUp, ThumbsDown, FileUp, Search, Globe, Volume2, Play, Pause, Square,
  RotateCcw, EyeOff, BarChart3, Clock, ArrowRight, ChevronDown, Activity
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { focusableWithin, trapTabKey } from './overlayFocus';
import { CuratorMark } from './components/CuratorLogo';
import { WeeklyReviewModal, WeeklyReadingItem } from './components/WeeklyReviewModal';
import { InterestsEditor } from './components/InterestsEditor';
import { ProviderTestButton } from './components/ProviderTestButton';
import { FeedbackActions } from './components/FeedbackActions';
import { DigestEmptyState } from './components/DigestEmptyState';
import { SettingsSection } from './components/SettingsSection';
import { loadInterests, saveInterests, suggestionsFromFolders, TAXONOMY_NOTE, type InterestSet } from './interests';
import { safeSetItem, safeSetJson, subscribeToStorageFailures, downloadAppData, type StorageFailure } from './storage';
import { DEFAULT_FEEDS } from './defaultFeeds';
import { articleNeedsLinkRefresh, dropBylineFurniture, dropRepeatedShortParagraphs, isMediaCreditParagraph, joinContinuedParagraphs, linkLabelsOnly, splitDenseParagraph } from '../lib/markup';

interface DiscoveredSource {
  title: string;
  siteUrl: string;
  folder: string;
  summary: string;
  rssStatus: 'native' | 'generatable' | 'blocked' | 'unavailable' | 'unreachable';
  canGenerateRss: boolean;
  feedUrl: string | null;
  feedFormat: string | null;
  sampleTitles: string[];
  investigationNote: string;
}

interface DigestItem {
  id: string;
  title: string;
  source: string;
  folder: string;
  categories?: string[];
  readTime: string;
  why: string;
  summary: string;
  url: string;
  fullText: string;
  isOutOfBubble: boolean;
  bannerImage?: string;
  avatar?: string;
  publishedAt?: string;
  quote?: string;
  // The publication's own blurb, carried on the articles a feed returns
  sourceDescription?: string;
  // Text from the cleaner that keeps a link's address carries the flag. A save written before
  // that change has no markers left in it, so the reader fetches the piece again and rewrites the
  // stored copy; `linkRefreshAt` keeps a piece with no links of its own from being fetched twice.
  linksCleaned?: boolean;
  linkRefreshAt?: number;
}

interface SourceItem {
  id: string;
  title: string;
  feedUrl: string;
  folder: string;
  categories: string[];
  status: 'active' | 'failing';
  failingReason?: string;
  lastSyncedAt?: number;
  avatar?: string;
  // A concise publication blurb, fetched from the feed or the site's metadata.
  description?: string;
  descriptionCheckedAt?: number;
  descriptionFetchFailed?: boolean;
}

interface SemanticFeedbackItem {
  id: string;
  vote: 'like' | 'dislike';
  title: string;
  text: string;
  timestamp: number;
  source?: string;
  folder?: string;
}

// Duplicate detection compares feeds by address, not by the name a reader gave them.
const normalizeFeedUrl = (url?: string): string => (url || '').trim().toLowerCase().replace(/\/+$/, '');

const normalizeCategoryLabels = (raw: unknown, fallback?: string): string[] => {
  const labels = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of labels) {
    if (typeof value !== 'string') continue;
    const normalized = value.replace(/\s+/g, ' ').trim().slice(0, 40);
    const label = normalized.toLowerCase() === 'uncategorized' ? 'General' : normalized;
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  if (result.length === 0 && !Array.isArray(raw) && fallback?.trim()) {
    const normalizedFallback = fallback.replace(/\s+/g, ' ').trim().slice(0, 40);
    result.push(normalizedFallback.toLowerCase() === 'uncategorized' ? 'General' : normalizedFallback);
  }
  return result;
};

// Show a feed URL short enough to scan: host plus a path cut on a slash, never
// mid-word. The full URL stays on the title tooltip.
function formatFeedUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    const text = parsed.hostname + path;
    if (text.length <= 44) return text;
    const trimmed = path.slice(0, Math.max(0, 44 - parsed.hostname.length));
    const cut = trimmed.lastIndexOf('/');
    return parsed.hostname + (cut > 0 ? trimmed.slice(0, cut) : trimmed) + '…';
  } catch {
    return url;
  }
}

function decodeArticleEntities(text: string): string {
  return (text || '')
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&#(\d+);/g, (entity, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&bull;/gi, '•')
    .replace(/&middot;/gi, '·')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;|&lsquo;/gi, '’')
    .replace(/&rdquo;|&ldquo;/gi, '”')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// Reader-side clean-up in case cached feed text still carries markup debris.
function buildArticleParagraphs(text: string): string[] {
  if (!text) return [];
  const clean = decodeArticleEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    // Articles stored before the cleaner was fixed still carry a space inside "U. S.",
    // "1. 79" and "74, 000"; repair them here so old saves read correctly too
    .replace(/(\d)([.,])\s+(\d)/g, '$1$2$3')
    .replace(/\b(?:[A-Za-z]\.\s+){1,}[A-Za-z]\./g, run => run.replace(/\s+/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    // Only a word that has run into the next one is repaired here. The old rule also fired
    // inside decimals, thousands separators and dotted abbreviations ("1. 79", "74, 000",
    // "U. S.", "e. g."), which the reader showed that way and the voice then read in pieces.
    .replace(/([a-z])([,;:])(?=[A-Za-z])/g, '$1$2 ')
    .replace(/([a-z])([.!?])(?=[A-Z][a-z])/g, '$1$2 ')
    .replace(/\n{3,}/g, '\n\n');

  const paragraphs = clean
    .split(/\n{2,}/)
    .map(paragraph => {
      let next = paragraph
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        // A stripped table cell can weld a word to the parameter that followed it ("The?install=").
        .replace(/([a-z])(?=[?#][a-z_]+=)/gi, '$1 ')
        // A URL broken across lines leaves its continuation marked by a bare ampersand.
        .replace(/^&\s*(?=[a-z_]+\s*=)/i, '')
        .trim();
      // A stripped inline link can leave a paragraph starting with the punctuation that followed it.
      if (/^[,;:.]/.test(next)) {
        next = next.replace(/^[,;:.]+\s*/, '');
        next = next.charAt(0).toUpperCase() + next.slice(1);
      }
      return next;
    })
    .filter(paragraph => paragraph.length > 0 && /[\p{L}\p{N}]/u.test(paragraph))
    .filter(paragraph => {
      // Length is measured on the words: a link's address is not part of the line the reader sees.
      const words = linkLabelsOnly(paragraph);
      return !(words.length < 180 && /^(click here|subscribe|sign up|follow me|read more|learn more|share this|advertisement)\b/i.test(words));
    })
    .filter(paragraph => !isMediaCreditParagraph(paragraph))
    // "[return]" and its siblings are footnote machinery, not prose.
    .filter(paragraph => !/^\[[^\]\n]{0,80}\]$/.test(paragraph))
    // "Watch on Aeon" is the player's call to action, left behind when the video is dropped.
    .filter(paragraph => !/^(?:[Ww]atch|[Ll]isten|[Vv]iew|[Pp]lay|[Rr]ead|[Ss]ee)\s+(?:on|at|in|via)\s+[\p{Lu}][\p{L}\s.&’']{1,30}$/u.test(paragraph))
    // A caption that is nothing but a hashtag ("#nofilter") is image furniture.
    .filter(paragraph => !/^#[\p{L}\d_]{2,30}$/u.test(paragraph))
    .filter(paragraph => !/^the post .+ appeared first on /i.test(paragraph));

  // A quotation and the attribution a publisher printed as its own paragraph are one
  // sentence; the reader and the voice both take their paragraphs from this list.
  // A section handed over as one <p> is shown as a few shorter paragraphs; read-aloud speaks
  // from this same list, so a spoken paragraph is still a paragraph on screen.
  return joinContinuedParagraphs(dropBylineFurniture(dropRepeatedShortParagraphs(paragraphs)))
    .flatMap(paragraph => splitDenseParagraph(paragraph));
}

// A feed that strips an anchor down to its text leaves a bare URL in the body, which the
// reader showed as inert prose. Those URLs become real links; anything else stays as written.
const INLINE_URL = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

// A link has to lead somewhere: "https://.../demo.db" is how a feed truncates an address,
// and making it tappable would send the reader to nowhere from the middle of a sentence.
const REAL_URL = /^(?:https?:\/\/|www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

// Sentence punctuation after a URL belongs to the sentence, not the address; brackets are
// only dropped when they were never opened inside the URL.
function trimUrlTail(raw: string): string {
  let url = raw;
  for (;;) {
    if (/[.,;:!?'"”’\]&]$/.test(url)) {
      url = url.slice(0, -1);
      continue;
    }
    if (url.endsWith(')')) {
      const opened = (url.match(/\(/g) || []).length;
      const closed = (url.match(/\)/g) || []).length;
      if (closed > opened) {
        url = url.slice(0, -1);
        continue;
      }
    }
    return url;
  }
}

interface ParagraphToken {
  text: string;
  href?: string;
}

function linkifyBareUrls(text: string): ParagraphToken[] {
  const tokens: ParagraphToken[] = [];
  let cursor = 0;
  INLINE_URL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_URL.exec(text)) !== null) {
    const url = trimUrlTail(match[0]);
    if (url.length < 9 || !REAL_URL.test(url)) continue;
    if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index) });
    tokens.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor) });
  return tokens;
}

// The feed cleaner keeps a link's address beside its words ("[the piece](https://…)") so the
// citation survives; the reader turns that marker back into a link.
const MARKDOWN_LINK = /\[([^\]\n]{1,240})\]\(([^)]+)\)/g;

function linkifyParagraph(paragraph: string): ParagraphToken[] {
  const tokens: ParagraphToken[] = [];
  let cursor = 0;
  MARKDOWN_LINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKDOWN_LINK.exec(paragraph)) !== null) {
    tokens.push(...linkifyBareUrls(paragraph.slice(cursor, match.index)));
    // Whitespace inside the address is cleaner debris; only a followable one becomes a link.
    const href = match[2].replace(/\s+/g, '');
    tokens.push(REAL_URL.test(href) ? { text: match[1], href } : { text: match[0] });
    cursor = match.index + match[0].length;
  }
  tokens.push(...linkifyBareUrls(paragraph.slice(cursor)));
  return tokens;
}

// Paragraph text with its links live. The tap is kept from the paragraph underneath, so
// following a link does not also start read-aloud from that paragraph.
function renderParagraphText(paragraph: string) {
  const tokens = linkifyParagraph(paragraph);
  if (tokens.length === 1 && !tokens[0].href) return tokens[0].text;
  return tokens.map((token, index) =>
    token.href ? (
      <a
        key={index}
        href={token.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={event => event.stopPropagation()}
        className="reader-inline-link break-words"
        title={`Open ${token.href}`}
      >{token.text}</a>
    ) : (
      <span key={index}>{token.text}</span>
    ),
  );
}

// ---- Read Aloud: text preparation and the spoken queue -----------------------

interface SpeechChunk {
  text: string;
  // -1 for the title, byline and summary; otherwise the rendered paragraph it belongs to
  paragraphIndex: number;
}

// Browsers cut a long utterance off (Chrome after roughly fifteen seconds, iOS stalls),
// so the reader speaks a sentence at a time: 220 characters is comfortably inside every
// engine's comfort zone, and the paragraph beat keeps the prose from running together.
const SPEECH_MAX_CHUNK_CHARS = 220;
const SPEECH_SENTENCE_PAUSE_MS = 40;
// iOS can take a moment before the first utterance starts; give it longer than the eye expects
// before telling the reader the device never spoke.
const SPEECH_START_GRACE_MS = 3000;
const SPEECH_PARAGRAPH_PAUSE_MS = 340;

const SPEECH_RATE_DEFAULT = 0.95;
const SPEECH_RATE_MIN = 0.7;
const SPEECH_RATE_MAX = 1.5;
const SPEECH_FALLBACK_LANG = 'en-GB';

const SPEECH_VOICE_AUTO = 'auto';
const SPEECH_VOICE_JAMIE_DEFAULT = 'default-jamie-premium';
// v4 defaults to Jamie (Premium), while retaining an explicitly chosen voice from v3.
const SPEECH_VOICE_STORAGE_KEY = 'curator_speech_voice_v4';
const SPEECH_RATE_STORAGE_KEY = 'curator_speech_rate';

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

function resolveSpeechVoice(
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
function speechVoiceChoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
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

  let out = decodeArticleEntities(text)
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

  // Remove Markdown formatting while retaining the words it decorates.
  out = out
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-+*•·]\s+/gm, '')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/```[^\n]*|```/g, ' ')
    .replace(/`/g, '')
    .replace(/~~|\*\*?|__?/g, ' ')
    .replace(/\|/g, ' ');

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

function splitIntoSentences(text: string): string[] {
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

// Title and byline, then the summary, then the article paragraph by paragraph. Each chunk
// keeps the index of the paragraph it came from, which is what the progress bar, the
// highlight and the tap-to-listen-from-here all follow.
export function buildSpeechQueue(article: DigestItem): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];

  const push = (text: string, paragraphIndex: number) => {
    // A link that was the whole sentence leaves only connectives once it is stripped
    // ("and url= and metadata="). Those are noise, not something to read out.
    const hadLink = /(?:https?:\/\/|www\.)\S/i.test(text);
    for (const sentence of splitIntoSentences(normaliseForSpeech(text))) {
      const words = sentence.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
      if (!words.length) continue;
      if (hadLink && words.length < 4) continue;
      chunks.push({ text: sentence, paragraphIndex });
    }
  };

  push(`${article.title}. By ${article.source}.`, -1);
  if (article.summary) push(article.summary, -1);
  buildArticleParagraphs(article.fullText).forEach((paragraph, index) => push(paragraph, index));

  return chunks;
}

// ---- Reader appearance ------------------------------------------------------
// The reader is the one screen that is read for minutes at a time, so it carries its own
// appearance: a low-glare theme, a serif or sans body, and a size the reader picks. The
// choice is per device and applies to the reader only — the rest of the app keeps its chrome.

type ReaderThemeId = 'paper' | 'dark' | 'sepia';
type ReaderFaceId = 'serif' | 'sans';

const READER_THEME_STORAGE_KEY = 'curator_reader_theme';
const READER_FACE_STORAGE_KEY = 'curator_reader_face';
const READER_SIZE_STORAGE_KEY = 'curator_reader_size';

// Paper is the default: warm cream behind soft charcoal, the quietest of the three.
const READER_THEMES: { id: ReaderThemeId; label: string; swatch: string; ink: string }[] = [
  { id: 'paper', label: 'Paper', swatch: '#f7f3ea', ink: '#242320' },
  { id: 'dark', label: 'Soft dark', swatch: '#1a1d24', ink: '#d8d6d0' },
  { id: 'sepia', label: 'Sepia', swatch: '#efe4ce', ink: '#362d24' },
];

const READER_SIZES = [16, 18, 20, 22] as const;
const READER_THEME_DEFAULT: ReaderThemeId = 'paper';
const READER_FACE_DEFAULT: ReaderFaceId = 'serif';
// 18px is the size a phone reader should get without touching anything.
const READER_SIZE_DEFAULT = 18;

function storedReaderTheme(): ReaderThemeId {
  const saved = localStorage.getItem(READER_THEME_STORAGE_KEY);
  return READER_THEMES.some(theme => theme.id === saved) ? (saved as ReaderThemeId) : READER_THEME_DEFAULT;
}

function storedReaderFace(): ReaderFaceId {
  return localStorage.getItem(READER_FACE_STORAGE_KEY) === 'sans' ? 'sans' : READER_FACE_DEFAULT;
}

function storedReaderSize(): number {
  const saved = Number(localStorage.getItem(READER_SIZE_STORAGE_KEY));
  return (READER_SIZES as readonly number[]).includes(saved) ? saved : READER_SIZE_DEFAULT;
}

export default function App() {
  // Navigation & View state
  const [activeTab, setActiveTab] = useState<'today' | 'saved' | 'sources' | 'settings' | 'feeds'>('today');
  const [selectedArticle, setSelectedArticle] = useState<DigestItem | null>(null);
  const [selectedFeedSource, setSelectedFeedSource] = useState<string | null>(null);
  const [feedStreamArticles, setFeedStreamArticles] = useState<DigestItem[]>([]);
  const [loadingFeedStream, setLoadingFeedStream] = useState<boolean>(false);
  // Server-side request tally, read whenever the Settings tab opens
  const [usageStats, setUsageStats] = useState<{
    today?: any;
    week?: any;
    month?: any;
    days?: any[];
    usdPerGbp?: number;
    peakNow?: boolean;
    rates?: { inputMiss: number; inputHit: number; output: number };
    retentionDays?: number;
  } | null>(null);
  // Bumped on every stream response so the list remounts cleanly when the filter changes;
  // without it the previous filter's cards were left in place under the new header.
  const [feedStreamRenderKey, setFeedStreamRenderKey] = useState<number>(0);
  const [readSourceIds, setReadSourceIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_read_sources');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    // Every starter feed begins unread, so the first run honestly shows what is waiting.
    return [];
  });
  const [readArticleIds, setReadArticleIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_read_articles');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });
  const [readingStats, setReadingStats] = useState<Record<string, { maxDepth?: number; finished?: boolean; lastRead?: number }>>(() => {
    try {
      const raw = localStorage.getItem('curator_reading_stats');
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  });
  const [refreshingSourceId, setRefreshingSourceId] = useState<string | null>(null);
  // A whole-library refresh, offered on the Feeds bar and beside failing sources
  const [refreshingAllFeeds, setRefreshingAllFeeds] = useState<boolean>(false);
  const sourceDescriptionRequestsRef = React.useRef(new Set<string>());
  // Which source descriptions are open — in the Sources list, and on the reader's byline
  const [expandedSourceDescriptionIds, setExpandedSourceDescriptionIds] = useState<string[]>([]);
  const [showReaderSourceNote, setShowReaderSourceNote] = useState<boolean>(false);
  // Reader appearance: theme, face, body size and whether the Aa menu is open
  const [readerTheme, setReaderTheme] = useState<ReaderThemeId>(storedReaderTheme);
  const [readerFace, setReaderFace] = useState<ReaderFaceId>(storedReaderFace);
  const [readerSize, setReaderSize] = useState<number>(storedReaderSize);
  const [showReaderAppearance, setShowReaderAppearance] = useState<boolean>(false);

  // App data state with localStorage persistence
  const [sources, setSources] = useState<SourceItem[]>(() => {
    // A new reader starts with the same eight feeds the server falls back to, so the first
    // digest is an edition rather than one publication's front page.
    const defaultSources: SourceItem[] = DEFAULT_FEEDS.map(feed => ({
      id: feed.id,
      title: feed.title,
      feedUrl: feed.feedUrl,
      folder: feed.folder,
      categories: [feed.folder],
      status: 'active' as const,
    }));

    // A few demo feeds shipped in early builds and were later retired. Drop those rows, and
    // only those rows: treating one stale entry as "the whole list is junk" is what used to
    // replace a tester's entire library with the single default feed.
    const isRetiredDemoFeed = (feedUrl?: string) => {
      const url = (feedUrl || '').toLowerCase();
      return url.includes('pmresearcher') ||
        url.includes('bhaskar.econ') ||
        url.includes('worldhistory.com');
    };

    const saved = localStorage.getItem('curator_sources');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return defaultSources;
        const kept = parsed.filter((source: SourceItem) =>
          source && typeof source === 'object' && !isRetiredDemoFeed(source.feedUrl)
        );
        // Only an all-stale list falls back to the defaults; anything the reader added is kept.
        if (kept.length === 0) return defaultSources;
        return kept.map((source: SourceItem) => ({
          ...source,
          categories: normalizeCategoryLabels(source.categories, source.folder),
        }));
      } catch (e) { /* ignore */ }
    }
    return defaultSources;
  });

  // The last edition this browser built, so a launch with no connection shows yesterday's
  // stories (labelled as such) instead of pretending the feeds were quiet.
  const [digest, setDigest] = useState<DigestItem[]>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('curator_digest_cache') || 'null');
      return Array.isArray(cached?.items) ? cached.items : [];
    } catch {
      return [];
    }
  });
  const [semanticSummary, setSemanticSummary] = useState<{
    feedbackExamples: number;
    providerVectors: number;
    deprioritized: number;
    localEngine?: boolean;
  } | null>(null);
  const [feedReport, setFeedReport] = useState<{
    attempted: number;
    failed: Array<{ title: string; feedUrl?: string; reason: string }>;
    failedCount?: number;
  } | null>(null);

  // First-run calibration flow for the semantic profile
  const [showSetupWizard, setShowSetupWizard] = useState<boolean>(() => {
    try {
      if (localStorage.getItem('curator_setup_complete')) return false;
      const savedFeedback = JSON.parse(localStorage.getItem('curator_semantic_feedback') || '[]');
      return !(Array.isArray(savedFeedback) && savedFeedback.length > 0);
    } catch {
      return true;
    }
  });
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loadingCalibration, setLoadingCalibration] = useState<boolean>(false);
  const [calibrationCandidates, setCalibrationCandidates] = useState<DigestItem[]>([]);
  const [calibrationIndex, setCalibrationIndex] = useState<number>(0);
  const [calibrationVotes, setCalibrationVotes] = useState<number>(0);
  const [savedArticles, setSavedArticles] = useState<DigestItem[]>(() => {
    const saved = localStorage.getItem('curator_saved_articles');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) { /* ignore */ }
    }
    return [];
  });
  const [savedIds, setSavedIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('curator_saved_ids');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [];
  });

  const [weeklyHistory, setWeeklyHistory] = useState<WeeklyReadingItem[]>(() => {
    const saved = localStorage.getItem('curator_weekly_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Older builds seeded demo history; drop only those known placeholder ids
          const seededIds = new Set(['wh_1', 'wh_2', 'wh_3', 'wh_4', 'wh_5', 'wh_6', 'wh_7']);
          return parsed.filter((it: WeeklyReadingItem) => !seededIds.has(it.id));
        }
      } catch (e) { /* ignore */ }
    }
    // Starts empty: history is only what the reader has actually finished
    return [];
  });
  const [showWeeklyReviewModal, setShowWeeklyReviewModal] = useState<boolean>(false);

  useEffect(() => {
    safeSetJson('curator_weekly_history', weeklyHistory);
  }, [weeklyHistory]);

  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weeklyRecent = weeklyHistory.filter(it => it.completedAt >= weekCutoff);
  const totalWeeklyMinutes = weeklyRecent.reduce((acc, it) => acc + (it.minutesSpent ?? 0), 0);
  const displayFolder = (folder?: string) =>
    (!folder || folder.trim().toLowerCase() === 'uncategorized') ? 'General' : folder;

  // The folder that took the most of this week's reading time
  const topWeeklyTopic = (() => {
    const counts: Record<string, number> = {};
    weeklyRecent.forEach(it => {
      const key = displayFolder(it.folder);
      counts[key] = (counts[key] || 0) + (it.minutesSpent ?? 0);
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || '—';
  })();

  const [signals, setSignals] = useState<{
    moreTopics: string[];
    lessTopics: string[];
    moreIds: string[];
    lessIds: string[];
    more: string[];
    less: string[];
  }>(() => {
    const saved = localStorage.getItem('curator_signals');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Older versions turned a vote into a broad folder preference. Keep exact article IDs,
        // but clear those topic rules so the semantic profile can learn from article content.
        return {
          moreTopics: [],
          lessTopics: [],
          moreIds: Array.isArray(parsed.moreIds) ? parsed.moreIds : [],
          lessIds: Array.isArray(parsed.lessIds) ? parsed.lessIds : [],
          more: [],
          less: [],
        };
      } catch (e) { /* ignore */ }
    }
    return { moreTopics: [], lessTopics: [], moreIds: [], lessIds: [], more: [], less: [] };
  });

  // Declared interests are settings the reader edits, not learned feedback, so they live
  // beside the vote profile and are sent as topic signals on every digest request.
  const [interests, setInterests] = useState<InterestSet>(() => loadInterests());
  useEffect(() => {
    saveInterests(interests);
  }, [interests]);

  const [semanticFeedback, setSemanticFeedback] = useState<SemanticFeedbackItem[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('curator_semantic_feedback') || '[]');
      if (!Array.isArray(saved)) return [];
      return saved
        .filter((item: any) => item && typeof item.id === 'string' &&
          (item.vote === 'like' || item.vote === 'dislike') &&
          typeof item.title === 'string' && typeof item.text === 'string' &&
          Number.isFinite(item.timestamp))
        .slice(-40);
    } catch {
      return [];
    }
  });
  const [serverGeminiAvailable, setServerGeminiAvailable] = useState<boolean>(false);
  const [startupApiStatus, setStartupApiStatus] = useState<'checking' | 'healthy' | 'issue'>('checking');
  const [startupApiMessage, setStartupApiMessage] = useState('Checking Curator server and configured providers…');
  const [showStartupApiPrompt, setShowStartupApiPrompt] = useState(false);
  const startupApiCheckRef = React.useRef(0);
  const startupApiCheckStartedRef = React.useRef(false);

  // Settings
  const DIGEST_ITEM_COUNTS = [3, 5, 8, 12, 15] as const;
  const READ_THROUGH_DEPTH = 85;
  // 75s covers a Cloud Run cold start plus a feed sweep; the softer hint at 20s gives the
  // reader a way out long before that.
  const DIGEST_TIMEOUT_MS = 75000;
  // Every reversible action gets the same window: the toast offering the undo and the pending
  // state it protects both stay up this long. Plain notices clear sooner.
  const UNDO_WINDOW_MS = 7000;
  const NOTICE_MS = 3500;
  const DIGEST_SLOW_HINT_MS = 20000;
  const [serendipityDial, setSerendipityDial] = useState<number>(() => {
    const saved = localStorage.getItem('curator_serendipity');
    return saved ? Number(saved) : 25;
  });
  // When the digest on screen was actually curated, so the header can say so honestly.
  const [digestCuratedAt, setDigestCuratedAt] = useState<number>(() => {
    const saved = Number(localStorage.getItem('curator_digest_curated_at'));
    if (Number.isFinite(saved) && saved > 0) return saved;
    // Older caches only kept the timestamp inside the payload. Without it a days-old edition
    // has no age to show and the header would have to guess.
    try {
      const cached = JSON.parse(localStorage.getItem('curator_digest_cache') || 'null');
      const fallback = Number(cached?.curatedAt);
      return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
    } catch {
      return 0;
    }
  });
  const [itemCount, setItemCount] = useState<number>(() => {
    const saved = localStorage.getItem('curator_item_count');
    if (!saved) return 8;
    const savedCount = Number(saved);
    if (DIGEST_ITEM_COUNTS.some(count => count === savedCount)) return savedCount;
    if (!Number.isFinite(savedCount)) return 8;
    return DIGEST_ITEM_COUNTS.reduce((closest, count) =>
      Math.abs(count - savedCount) < Math.abs(closest - savedCount) ? count : closest,
      8
    );
  });
  const [compactCards, setCompactCards] = useState<boolean>(() => localStorage.getItem('curator_compact_cards') === '1');
  // Count, density and serendipity live behind one pill instead of filling the first screen
  const [showDigestSettings, setShowDigestSettings] = useState<boolean>(false);
  const [aiProvider, setAiProvider] = useState<string>(() => {
    const saved = localStorage.getItem('curator_ai_provider');
    if (saved === 'openai') return 'openai-compatible';
    if (saved === 'gemini') return 'deterministic';
    return saved || 'deterministic';
  });
  const [customApiKey, setCustomApiKey] = useState<string>(() => localStorage.getItem('curator_custom_api_key') || '');
  const [aiBaseUrl, setAiBaseUrl] = useState<string>(() => localStorage.getItem('curator_ai_base_url') || '');
  const [aiModel, setAiModel] = useState<string>(() => localStorage.getItem('curator_ai_model') || '');
  const [embeddingProvider, setEmbeddingProvider] = useState<string>(() => localStorage.getItem('curator_embedding_provider') || 'openai-compatible');
  const [embeddingApiKey, setEmbeddingApiKey] = useState<string>(() => localStorage.getItem('curator_embedding_api_key') || '');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState<string>(() => localStorage.getItem('curator_embedding_base_url') || '');
  const [embeddingModel, setEmbeddingModel] = useState<string>(() => localStorage.getItem('curator_embedding_model') || '');
  const embeddingKeyMatchesChatProvider =
    (embeddingProvider === 'gemini' && aiProvider === 'gemini') ||
    (embeddingProvider === 'openai-compatible' && aiProvider === 'openai-compatible');
  const semanticServiceReady = embeddingProvider === 'openai-compatible'
    ? Boolean((embeddingApiKey || (embeddingKeyMatchesChatProvider && customApiKey)) && (embeddingBaseUrl || (embeddingKeyMatchesChatProvider && aiBaseUrl)))
    : embeddingProvider === 'gemini'
      ? Boolean(embeddingApiKey || (embeddingKeyMatchesChatProvider && customApiKey) || serverGeminiAvailable)
      : false;

  // Starts true: the first digest request is queued by an effect right after mount, so the
  // view opens on the "synthesizing" state instead of flashing "no new items today".
  const [loadingDigest, setLoadingDigest] = useState<boolean>(true);
  // A digest request can die on a cold container. Both are surfaced in the view, so a
  // stalled request never leaves "Synthesizing…" on screen forever.
  const [digestSlow, setDigestSlow] = useState<boolean>(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  // True when the last attempt failed to reach the server at all, as opposed to the server
  // answering that it had nothing to offer.
  const [digestOffline, setDigestOffline] = useState<boolean>(false);
  // The request tally and its cost estimate are for alpha testing, not for readers: ?debug in
  // the URL, or a stored flag, is the only way to see them.
  const [showDiagnostics] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return new URLSearchParams(window.location.search).has('debug')
        || localStorage.getItem('curator_debug') === '1';
    } catch {
      return false;
    }
  });
  // Set when this browser refuses to persist the library (quota or blocked storage)
  const [storageFailure, setStorageFailure] = useState<StorageFailure | null>(null);
  const [activeToast, setActiveToast] = useState<{
    id: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const toastTimeoutRef = React.useRef<any>(null);
  // Screen Wake Lock held while read-aloud is playing so the phone does not sleep mid-article
  const wakeLockRef = React.useRef<any>(null);
  const wakeLockWantedRef = React.useRef(false);
  // Monotonic ids so a slow, superseded response can never overwrite newer state
  const digestRequestRef = React.useRef(0);
  // The request in flight, so a retry or a timeout can actually cancel it
  const digestAbortRef = React.useRef<AbortController | null>(null);
  const feedStreamRequestRef = React.useRef(0);
  // Read Aloud queue: the sentences still to speak, which one is playing, and the session
  // they belong to, so a superseded callback can never speak over a newer one
  const speechQueueRef = React.useRef<SpeechChunk[]>([]);
  const speechIndexRef = React.useRef(0);
  const speechArticleIdRef = React.useRef<string | null>(null);
  const speechSessionRef = React.useRef(0);
  const speechStateRef = React.useRef<'idle' | 'playing' | 'paused'>('idle');
  const speechGapTimerRef = React.useRef<any>(null);
  // The utterance in flight, so resume knows whether to continue one or speak the next
  const speechUtteranceRef = React.useRef<SpeechSynthesisUtterance | null>(null);
  const speechArticleItemRef = React.useRef<DigestItem | null>(null);
  // Whether the engine actually started the current session (iOS refuses silently sometimes)
  const speechStartedRef = React.useRef(false);

  // Hidden cards: each "Less like this" keeps the story in place as an inline Undo target
  const [mutedCards, setMutedCards] = useState<Record<string, DigestItem>>({});

  // Add source modal state
  const [showAddSourceModal, setShowAddSourceModal] = useState<boolean>(false);
  const [newSourceTitle, setNewSourceTitle] = useState<string>('');
  const [newSourceUrl, setNewSourceUrl] = useState<string>('');
  const [newSourceTitleError, setNewSourceTitleError] = useState<string | null>(null);
  const [newSourceUrlError, setNewSourceUrlError] = useState<string | null>(null);
  const [newSourceFolder, setNewSourceFolder] = useState<string>('General');
  const [newSourceFolderCustom, setNewSourceFolderCustom] = useState(false);
  const [newSourceValidating, setNewSourceValidating] = useState(false);

  // OPML Import state
  const [importText, setImportText] = useState<string>('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isDraggingOpml, setIsDraggingOpml] = useState<boolean>(false);
  const [isImportingOpml, setIsImportingOpml] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  // A file that would land on top of an existing list is confirmed in the modal first.
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    totalImported: number;
    successCount: number;
    failCount: number;
    duplicates?: number;
    failures?: Array<{ title: string; reason: string }>;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const addSourceOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const importOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const wizardOverlayRef = React.useRef<HTMLDivElement | null>(null);

  // Google Search & RSS investigation state
  const [discoverQuery, setDiscoverQuery] = useState<string>('');
  const [sourceSearch, setSourceSearch] = useState<string>('');
  const [categoryEditorSourceId, setCategoryEditorSourceId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverResults, setDiscoverResults] = useState<DiscoveredSource[]>([]);
  const [discoverGroundingLinks, setDiscoverGroundingLinks] = useState<Array<{ title: string; uri: string }>>([]);
  const [hasSearchedSources, setHasSearchedSources] = useState<boolean>(false);

  // Reading view timer & depth tracking

  // Read Aloud (onboard speech synthesis). Voice and rate are chosen explicitly now: the
  // device default is often a compact, robotic voice at an odd speed, and the attachment
  // the reader wants is a calm Enhanced voice at just under normal pace.
  const [speechPlaying, setSpeechPlaying] = useState<boolean>(false);
  const [speechPaused, setSpeechPaused] = useState<boolean>(false);
  // The article the running session belongs to; null when nothing is being read
  const [speechArticleId, setSpeechArticleId] = useState<string | null>(null);
  const [speechProgress, setSpeechProgress] = useState<{ index: number; total: number; paragraph: number }>({
    index: 0,
    total: 0,
    paragraph: -1
  });
  const [speechVoices, setSpeechVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speechVoiceUri, setSpeechVoiceUri] = useState<string>(() => {
    const saved = localStorage.getItem(SPEECH_VOICE_STORAGE_KEY);
    if (saved) return saved;
    const previous = localStorage.getItem('curator_speech_voice_v3');
    return previous && previous !== SPEECH_VOICE_AUTO ? previous : SPEECH_VOICE_JAMIE_DEFAULT;
  });
  const [speechRate, setSpeechRate] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= SPEECH_RATE_MIN && saved <= SPEECH_RATE_MAX
      ? saved
      : SPEECH_RATE_DEFAULT;
  });

  useEffect(() => {
    safeSetItem(SPEECH_VOICE_STORAGE_KEY, speechVoiceUri);
  }, [speechVoiceUri]);

  useEffect(() => {
    safeSetItem(SPEECH_RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  // Safari fills the voice list lazily and does not always fire voiceschanged
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const loadVoices = () => {
      const next = window.speechSynthesis.getVoices();
      if (next && next.length > 0) setSpeechVoices(next);
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    const late = setTimeout(loadVoices, 600);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      clearTimeout(late);
    };
  }, []);

  const automaticSpeechVoice = React.useMemo(
    () => resolveSpeechVoice(speechVoices, SPEECH_VOICE_AUTO),
    [speechVoices]
  );

  const activeSpeechVoice = React.useMemo(
    () => (speechVoiceUri === SPEECH_VOICE_AUTO
      ? automaticSpeechVoice
      : resolveSpeechVoice(speechVoices, speechVoiceUri)),
    [speechVoices, speechVoiceUri, automaticSpeechVoice]
  );

  const speechVoiceLabel = activeSpeechVoice ? activeSpeechVoice.name : 'your device voice';

  // One entry per voice, English first, by name
  const speechVoiceOptions = React.useMemo(
    () => speechVoiceChoices(speechVoices),
    [speechVoices]
  );
  const jamiePremiumSpeechVoice = React.useMemo(
    () => resolveSpeechVoice(speechVoices, SPEECH_VOICE_JAMIE_DEFAULT),
    [speechVoices]
  );

  // A refused write is worth interrupting for: the reader needs to know that what they save
  // may not survive a reload, and gets a one-tap export while the warning is on screen.
  useEffect(() => subscribeToStorageFailures(setStorageFailure), []);

  useEffect(() => {
    // Saved articles carry their full bodies, so this is the write most likely to hit the
    // origin's quota. If it does, keep the queue by dropping the bodies rather than losing
    // every saved title.
    if (safeSetJson('curator_saved_articles', savedArticles)) return;
    safeSetJson('curator_saved_articles', savedArticles.map(({ fullText, ...rest }) => rest));
  }, [savedArticles]);

  useEffect(() => {
    safeSetJson('curator_sources', sources);
  }, [sources]);

  useEffect(() => {
    if (activeTab !== 'sources') {
      sources.forEach(source => {
        if (source.descriptionFetchFailed && !source.descriptionCheckedAt) {
          sourceDescriptionRequestsRef.current.delete(source.id);
        }
      });
      return;
    }

    const batch = sources
      .filter(source => !source.description?.trim() && !source.descriptionCheckedAt && !sourceDescriptionRequestsRef.current.has(source.id))
      .slice(0, 20);
    if (batch.length === 0) return;

    const requestedIds = new Set(batch.map(source => source.id));
    requestedIds.forEach(id => sourceDescriptionRequestsRef.current.add(id));

    const loadDescriptions = async () => {
      try {
        const response = await fetch('/api/source-descriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sources: batch.map(({ id, feedUrl }) => ({ id, feedUrl })) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(data.sources)) throw new Error('Could not load source descriptions.');

        const descriptions = new Map<string, { description?: string; error?: string }>(
          data.sources.map((entry: { id?: string; description?: string; error?: string }) => [String(entry.id || ''), entry] as const)
        );
        const checkedAt = Date.now();
        setSources(prev => prev.map(source => {
          if (!requestedIds.has(source.id)) return source;
          const result = descriptions.get(source.id);
          const description = typeof result?.description === 'string' ? result.description.trim() : '';
          const failed = !result || Boolean(result.error);
          return {
            ...source,
            description: description || source.description,
            descriptionCheckedAt: failed ? source.descriptionCheckedAt : checkedAt,
            descriptionFetchFailed: failed && !source.description && !description,
          };
        }));
      } catch {
        setSources(prev => prev.map(source => requestedIds.has(source.id)
          ? { ...source, descriptionFetchFailed: !source.description }
          : source));
      }
    };

    void loadDescriptions();
  }, [activeTab, sources]);

  useEffect(() => {
    safeSetJson('curator_saved_ids', savedIds);
  }, [savedIds]);

  useEffect(() => {
    safeSetJson('curator_signals', signals);
  }, [signals]);

  useEffect(() => {
    safeSetJson('curator_semantic_feedback', semanticFeedback);
  }, [semanticFeedback]);

  const checkStartupServices = async () => {
    const checkId = ++startupApiCheckRef.current;
    const isCurrentCheck = () => checkId === startupApiCheckRef.current;
    setStartupApiStatus('checking');
    setStartupApiMessage('Checking Curator server and configured providers…');
    setShowStartupApiPrompt(false);

    const fetchJson = async (url: string, init: RequestInit = {}, timeoutMs = 12000) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        return { response, data };
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const flagIssue = (message: string) => {
      if (!isCurrentCheck()) return;
      setStartupApiStatus('issue');
      setStartupApiMessage(message);
      setShowStartupApiPrompt(true);
      setActiveTab('settings');
      setShowSetupWizard(false);
      window.setTimeout(() => {
        if (isCurrentCheck()) {
          document.getElementById('provider-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    };

    const testProvider = async (
      label: string,
      kind: 'chat' | 'embedding',
      provider: string,
      apiKey: string,
      baseUrl: string,
      model: string,
    ): Promise<string | null> => {
      try {
        const { response, data } = await fetchJson('/api/test-provider', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, provider, apiKey, baseUrl, model }),
        }, 20000);
        if (!response.ok || !data?.ok) {
          return `${label}: ${String(data?.error || `Test failed (HTTP ${response.status}).`).slice(0, 240)}`;
        }
        return null;
      } catch (error: any) {
        return `${label}: ${error?.name === 'AbortError' ? 'request timed out' : 'could not reach the provider'}.`;
      }
    };

    try {
      const health = await fetchJson('/api/health', { cache: 'no-store' });
      if (!health.response.ok || health.data?.ok !== true) {
        throw new Error(`Curator server returned HTTP ${health.response.status}.`);
      }

      const usage = await fetchJson('/api/usage', { cache: 'no-store' });
      if (!usage.response.ok || !Number.isFinite(Number(usage.data?.today?.apiCalls))) {
        throw new Error('Curator server activity tracking did not return a valid status.');
      }

      const semanticStatus = await fetchJson('/api/semantic-status', { cache: 'no-store' });
      if (!semanticStatus.response.ok) {
        throw new Error(`Service status returned HTTP ${semanticStatus.response.status}.`);
      }
      const serverGeminiConfigured = Boolean(semanticStatus.data?.geminiConfigured);
      if (!isCurrentCheck()) return;
      setServerGeminiAvailable(serverGeminiConfigured);

      const checks: Array<Promise<string | null>> = [];
      const chatKey = customApiKey.trim();
      const chatConfigured = aiProvider === 'openai-compatible'
        ? Boolean(chatKey && aiBaseUrl.trim() && aiModel.trim())
        : aiProvider === 'anthropic'
          ? Boolean(chatKey)
          : aiProvider === 'gemini'
            ? Boolean(chatKey || serverGeminiConfigured)
            : false;
      if (chatConfigured) {
        checks.push(testProvider('Digest writing', 'chat', aiProvider, chatKey, aiBaseUrl.trim(), aiModel.trim()));
      }

      const effectiveEmbeddingKey = embeddingApiKey.trim() || (embeddingKeyMatchesChatProvider ? chatKey : '');
      const effectiveEmbeddingBaseUrl = embeddingBaseUrl.trim() ||
        (embeddingKeyMatchesChatProvider ? aiBaseUrl.trim() : '');
      const embeddingConfigured = embeddingProvider === 'openai-compatible'
        ? Boolean(effectiveEmbeddingKey && effectiveEmbeddingBaseUrl)
        : embeddingProvider === 'gemini'
          ? Boolean(effectiveEmbeddingKey || serverGeminiConfigured)
          : false;
      if (embeddingConfigured) {
        checks.push(testProvider(
          'Topic matching',
          'embedding',
          embeddingProvider,
          effectiveEmbeddingKey,
          effectiveEmbeddingBaseUrl,
          embeddingModel.trim(),
        ));
      }

      const failures = (await Promise.all(checks)).filter((message): message is string => Boolean(message));
      if (!isCurrentCheck()) return;
      if (failures.length > 0) {
        flagIssue(`A configured provider did not respond successfully: ${failures.join(' ')}`);
        return;
      }

      setStartupApiStatus('healthy');
      setStartupApiMessage(checks.length > 0
        ? 'Curator API, server activity tracking, and configured providers are responding.'
        : 'Curator API and server activity tracking are responding. Built-in services are ready; no external provider needs checking.');
    } catch (error: any) {
      if (!isCurrentCheck()) return;
      setServerGeminiAvailable(false);
      flagIssue(error?.name === 'AbortError'
        ? 'Curator’s server check timed out. Check your connection, or update provider settings if the server is reachable again.'
        : `Curator’s server or API status check failed: ${String(error?.message || 'No response from the server')}`);
    }
  };

  useEffect(() => {
    if (startupApiCheckStartedRef.current) return;
    startupApiCheckStartedRef.current = true;
    void checkStartupServices();
  }, []);

  useEffect(() => {
    safeSetItem('curator_serendipity', serendipityDial.toString());
  }, [serendipityDial]);

  useEffect(() => {
    if (digestCuratedAt > 0) {
      safeSetItem('curator_digest_curated_at', String(digestCuratedAt));
    }
  }, [digestCuratedAt]);

  // Hold the page still while a full-screen dialog is open, so the content behind it
  // cannot scroll out from under the reader's finger. Both elements are locked: which one
  // actually scrolls depends on the browser and on the page's overflow rules.
  useEffect(() => {
    if (!showSetupWizard && !showImportModal && !showAddSourceModal) return;
    const root = document.documentElement;
    const previousBody = document.body.style.overflow;
    const previousRoot = root.style.overflow;
    document.body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBody;
      root.style.overflow = previousRoot;
    };
  }, [showSetupWizard, showImportModal, showAddSourceModal]);

  useEffect(() => {
    if (!showDigestSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowDigestSettings(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showDigestSettings]);

  // The three full-screen overlays are dialogs too: Escape closes the top one, Tab stays inside
  // it, and focus moves in when it opens instead of staying on the button behind.
  useEffect(() => {
    const overlay = showAddSourceModal
      ? addSourceOverlayRef.current
      : showImportModal
        ? importOverlayRef.current
        : showSetupWizard
          ? wizardOverlayRef.current
          : null;
    if (!overlay) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (showAddSourceModal) setShowAddSourceModal(false);
        else if (showImportModal) setShowImportModal(false);
        else if (showSetupWizard) dismissSetupWizard();
        return;
      }
      trapTabKey(event, overlay);
    };

    window.addEventListener('keydown', onKeyDown, true);
    const focusTimer = window.setTimeout(() => {
      if (!overlay.contains(document.activeElement)) focusableWithin(overlay)[0]?.focus();
    }, 30);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [showAddSourceModal, showImportModal, showSetupWizard]);

  useEffect(() => {
    safeSetItem('curator_item_count', itemCount.toString());
  }, [itemCount]);

  useEffect(() => {
    safeSetItem('curator_compact_cards', compactCards ? '1' : '0');
  }, [compactCards]);

  useEffect(() => {
    safeSetItem('curator_custom_api_key', customApiKey);
  }, [customApiKey]);

  useEffect(() => {
    safeSetItem('curator_ai_base_url', aiBaseUrl);
  }, [aiBaseUrl]);

  useEffect(() => {
    safeSetItem('curator_ai_model', aiModel);
  }, [aiModel]);

  useEffect(() => {
    safeSetItem('curator_embedding_provider', embeddingProvider);
  }, [embeddingProvider]);

  useEffect(() => {
    safeSetItem('curator_embedding_api_key', embeddingApiKey);
  }, [embeddingApiKey]);

  useEffect(() => {
    safeSetItem('curator_embedding_base_url', embeddingBaseUrl);
  }, [embeddingBaseUrl]);

  useEffect(() => {
    safeSetItem('curator_embedding_model', embeddingModel);
  }, [embeddingModel]);

  useEffect(() => {
    safeSetJson('curator_read_sources', readSourceIds);
  }, [readSourceIds]);

  useEffect(() => {
    safeSetJson('curator_read_articles', readArticleIds);
  }, [readArticleIds]);

  useEffect(() => {
    safeSetJson('curator_reading_stats', readingStats);
  }, [readingStats]);

  useEffect(() => {
    safeSetItem(READER_THEME_STORAGE_KEY, readerTheme);
  }, [readerTheme]);

  useEffect(() => {
    safeSetItem(READER_FACE_STORAGE_KEY, readerFace);
  }, [readerFace]);

  useEffect(() => {
    safeSetItem(READER_SIZE_STORAGE_KEY, String(readerSize));
  }, [readerSize]);

  useEffect(() => {
    // While setup is open, calibration votes accumulate first and one digest is built at the end.
    if (showSetupWizard) return;
    // Debounced so dragging the serendipity slider or tapping counts issues one request, not dozens
    const timer = setTimeout(() => { generateDigest(); }, 450);
    return () => clearTimeout(timer);
  }, [itemCount, serendipityDial, signals, semanticFeedback, interests, showSetupWizard]);
  useEffect(() => {
    if (activeTab === 'feeds') {
      fetchFeedStream(selectedFeedSource || 'all');
    }
  }, [activeTab, selectedFeedSource]);

  useEffect(() => {
    if (activeTab === 'settings') loadUsageStats();
  }, [activeTab]);

  const loadUsageStats = async () => {
    try {
      const res = await fetch('/api/usage');
      if (res.ok) setUsageStats(await res.json());
    } catch {
      // The tally is a convenience; a failure just leaves the last reading in place
    }
  };

  const fetchFeedStream = async (sourceTitle?: string) => {
    const requestId = ++feedStreamRequestRef.current;
    setLoadingFeedStream(true);
    try {
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceTitle: sourceTitle || 'all', sources })
      });
      const data = await res.json();
      if (requestId !== feedStreamRequestRef.current) return;
      if (Array.isArray(data.articles)) {
        setFeedStreamArticles(data.articles);
        setFeedStreamRenderKey(prev => prev + 1);
        applySourceMetadata(data.articles);
      }
    } catch (e) {
      // fallback
    } finally {
      if (requestId === feedStreamRequestRef.current) setLoadingFeedStream(false);
    }
  };

  const handleOpenFeedStream = (sourceTitle: string, sourceId?: string) => {
    // The tab/source effect performs the fetch; calling it here too caused a duplicate request
    setSelectedFeedSource(sourceTitle);
    setActiveTab('feeds');

    if (sourceId) {
      if (!readSourceIds.includes(sourceId)) {
        setReadSourceIds(prev => [...prev, sourceId]);
        const matched = sources.find(s => s.id === sourceId);
        showToast(`Marked ${matched ? matched.title : sourceTitle} updates as read`);
      }
    } else if (sourceTitle && sourceTitle !== 'all') {
      const match = sources.find(
        s => s.title.toLowerCase() === sourceTitle.toLowerCase() ||
             sourceTitle.toLowerCase().includes(s.title.toLowerCase())
      );
      if (match && !readSourceIds.includes(match.id)) {
        setReadSourceIds(prev => [...prev, match.id]);
        showToast(`Marked ${match.title} updates as read`);
      }
    }
  };

  const markAllSourcesAsRead = () => {
    const all = sources.map(s => s.id);
    setReadSourceIds(all);
    showToast('All feeds marked as read — dots dismissed');
  };

  const markAllSourcesAsUnread = () => {
    setReadSourceIds([]);
    showToast('Unread indicators reset');
  };

  // Every article carries its feed's own blurb and proves the feed was just read, so cache
  // both on the matching source: the description stays available offline, and the row's
  // sync status is honest without any extra request.
  const applySourceMetadata = (items: Array<{ source?: string; sourceDescription?: string }>) => {
    if (!items || items.length === 0) return;
    const seen = new Set<string>();
    const descriptions = new Map<string, string>();
    items.forEach(item => {
      const name = (item?.source || '').trim().toLowerCase();
      if (!name) return;
      seen.add(name);
      const description = (item?.sourceDescription || '').trim();
      if (description && !descriptions.has(name)) descriptions.set(name, description);
    });
    if (seen.size === 0) return;

    const syncedAt = Date.now();
    setSources(prev => {
      let changed = false;
      const next = prev.map(src => {
        const key = src.title.trim().toLowerCase();
        if (!seen.has(key)) return src;
        const description = descriptions.get(key) || src.description;
        // A run of overlapping fetches within a minute must not churn state or storage
        const alreadyFresh = src.status === 'active' && !src.failingReason &&
          src.description === description &&
          typeof src.lastSyncedAt === 'number' && syncedAt - src.lastSyncedAt < 60 * 1000;
        if (alreadyFresh) return src;
        changed = true;
        return {
          ...src,
          description,
          descriptionFetchFailed: description ? false : src.descriptionFetchFailed,
          lastSyncedAt: syncedAt,
          status: 'active' as const,
          failingReason: undefined,
        };
      });
      return changed ? next : prev;
    });
  };

  // The digest run also reports which feeds failed. Mark those sources as needing attention,
  // so "Tap to review sources" lands on the rows that actually broke instead of a wall of
  // "Active" with no sign of the problem.
  const applyFeedReport = (report: { failed?: Array<{ title?: string; feedUrl?: string; reason?: string }> } | null) => {
    const failed = Array.isArray(report?.failed) ? report!.failed! : [];
    if (failed.length === 0) return;
    setSources(prev => {
      let changed = false;
      const next = prev.map(src => {
        const match = failed.find(entry =>
          (entry.feedUrl && src.feedUrl && entry.feedUrl.trim().toLowerCase() === src.feedUrl.trim().toLowerCase()) ||
          (entry.title && entry.title.trim().toLowerCase() === src.title.trim().toLowerCase())
        );
        if (!match) return src;
        const reason = (match.reason || 'This feed returned nothing.').trim();
        if (src.status === 'failing' && src.failingReason === reason) return src;
        changed = true;
        return { ...src, status: 'failing' as const, failingReason: reason };
      });
      return changed ? next : prev;
    });
  };

  const generateDigest = async (options?: { fresh?: boolean }) => {
    const requestId = ++digestRequestRef.current;
    // A retry must cancel the request it replaces, and a request that never answers has to
    // end in a retryable state rather than an endless "Synthesizing…".
    digestAbortRef.current?.abort();
    const controller = new AbortController();
    digestAbortRef.current = controller;
    setLoadingDigest(true);
    setDigestError(null);
    setDigestSlow(false);
    const timeout = window.setTimeout(() => controller.abort(), DIGEST_TIMEOUT_MS);
    const slowHint = window.setTimeout(() => {
      if (requestId === digestRequestRef.current) setDigestSlow(true);
    }, DIGEST_SLOW_HINT_MS);
    try {
      let readingStats = {};
      try {
        readingStats = JSON.parse(localStorage.getItem('curator_reading_stats') || '{}');
      } catch (e) { /* ignore */ }

      // Freshness history lives in this browser. The digest currently on screen is not
      // "already shown" — the server only down-weights pieces you have moved past.
      let shownHistory: Array<{ id: string; shownAt: number }> = [];
      try {
        const savedHistory = JSON.parse(localStorage.getItem('curator_digest_history') || '[]');
        if (Array.isArray(savedHistory)) {
          shownHistory = savedHistory
            .filter((entry: any) => entry && typeof entry.id === 'string' && Number.isFinite(entry.shownAt))
            .slice(-150);
        }
      } catch {
        shownHistory = [];
      }

      const currentDigestIds = new Set(digest.map(item => item.id));
      const recentlyShown = shownHistory.filter(entry => !currentDigestIds.has(entry.id));

      const res = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          signals: { ...signals, moreTopics: interests.more, lessTopics: interests.less },
          feedback: semanticFeedback,
          readingStats,
          serendipityDial,
          itemCount,
          provider: aiProvider,
          apiKey: customApiKey,
          baseUrl: aiBaseUrl,
          model: aiModel,
          embeddingProvider,
          embeddingApiKey,
          embeddingBaseUrl,
          embeddingModel,
          recentlyShown,
          previousDigestIds: [...currentDigestIds],
          fresh: Boolean(options?.fresh),
          seed: options?.fresh ? `${Date.now()}-${Math.random()}` : 'stable',
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (requestId !== digestRequestRef.current) return;
      if (!res.ok) {
        const message = data?.error
          ? `Curator could not build the digest: ${String(data.error).slice(0, 200)}`
          : `Curator’s server returned HTTP ${res.status}.`;
        if (digest.length === 0) setDigestError(message);
        else showToast(message);
        return;
      }
      setDigestError(null);
      setDigestOffline(false);
      setDigestCuratedAt(Date.now());
      if (Array.isArray(data.digest) && data.digest.length > 0) {
        setDigest(data.digest);
        safeSetJson('curator_digest_cache', { curatedAt: Date.now(), items: data.digest });
        applySourceMetadata(data.digest);
        if (data.semanticSummary) setSemanticSummary(data.semanticSummary);
        if (data.feedReport) {
          setFeedReport(data.feedReport);
          applyFeedReport(data.feedReport);
        }

        const shownAt = Date.now();
        const freshIds = new Set<string>(data.digest.map((item: DigestItem) => item.id));
        const mergedHistory = [
          ...shownHistory.filter(entry => !freshIds.has(entry.id)),
          ...data.digest.map((item: DigestItem) => ({ id: item.id, shownAt })),
        ].slice(-150);
        safeSetJson('curator_digest_history', mergedHistory);
      } else if (options?.fresh) {
        showToast('No other stories are ready right now. Restore hidden stories or review your sources.');
      }
    } catch {
      if (requestId !== digestRequestRef.current) return;
      const timedOut = controller.signal.aborted;
      const message = timedOut
        ? 'Curator’s server did not answer in time. It may be waking up from idle — try again in a moment.'
        : 'Could not reach Curator’s server. Check your connection and try again.';
      // With stories already on screen a toast is enough; an empty screen needs a card that
      // stays put, because a passing message looks identical to "nothing to read today".
      setDigestOffline(true);
      if (digest.length === 0) setDigestError(message);
      else showToast(timedOut ? 'Digest took too long — try refreshing again' : 'Could not refresh the digest');
    } finally {
      window.clearTimeout(timeout);
      window.clearTimeout(slowHint);
      if (digestAbortRef.current === controller) digestAbortRef.current = null;
      if (requestId === digestRequestRef.current) {
        setLoadingDigest(false);
        setDigestSlow(false);
      }
    }
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState(false);

  useEffect(() => {
    if (!pendingDeleteId && !pendingReset) return;
    const t = setTimeout(() => { setPendingDeleteId(null); setPendingReset(false); }, UNDO_WINDOW_MS);
    return () => clearTimeout(t);
  }, [pendingDeleteId, pendingReset]);

  const showToast = (msg: string, actionLabel?: string, onAction?: () => void) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    const item = {
      id: Math.random().toString(36).substring(2, 9),
      message: msg,
      actionLabel,
      onAction
    };
    setActiveToast(item);
    toastTimeoutRef.current = setTimeout(() => {
      setActiveToast(prev => (prev?.id === item.id ? null : prev));
    }, onAction ? UNDO_WINDOW_MS : NOTICE_MS);
  };

  const recordSemanticFeedback = (item: DigestItem, vote: 'like' | 'dislike') => {
    const text = `${item.title}\n${item.summary}\n${item.fullText}`
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    setSemanticFeedback(prev => [
      ...prev.filter(entry => entry.id !== item.id),
      { id: item.id, vote, title: item.title, text, timestamp: Date.now(), source: item.source, folder: item.folder },
    ].slice(-40));
  };

  const removeSemanticFeedback = (itemId: string) => {
    setSemanticFeedback(prev => prev.filter(entry => entry.id !== itemId));
  };

  const markSetupComplete = () => {
    safeSetItem('curator_setup_complete', '1');
  };

  const openSetupWizard = () => {
    setSetupStep(1);
    setSetupError(null);
    setCalibrationIndex(0);
    setCalibrationVotes(0);
    setShowSetupWizard(true);
  };

  const dismissSetupWizard = () => {
    markSetupComplete();
    setShowSetupWizard(false);
  };

  const finishSetup = () => {
    markSetupComplete();
    setShowSetupWizard(false);
    showToast(calibrationVotes > 0
      ? `Calibrated with ${calibrationVotes} verdict${calibrationVotes === 1 ? '' : 's'} — building your digest`
      : 'Setup saved — building your digest');
  };

  const loadCalibration = async () => {
    setLoadingCalibration(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources,
          excludeIds: semanticFeedback.map(entry => entry.id),
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        setSetupError(data?.error || 'No live articles came back. Check your feed URLs, then try again.');
        return;
      }
      setCalibrationCandidates(data.candidates);
      applySourceMetadata(data.candidates);
      setCalibrationIndex(0);
      setCalibrationVotes(0);
      setSetupStep(2);
    } catch {
      setSetupError('Could not reach your feeds. Check your connection and try again.');
    } finally {
      setLoadingCalibration(false);
    }
  };

  const answerCalibration = (item: DigestItem, vote: 'like' | 'dislike') => {
    recordSemanticFeedback(item, vote);
    setCalibrationVotes(prev => prev + 1);
    const nextIndex = calibrationIndex + 1;
    setCalibrationIndex(nextIndex);
    if (nextIndex >= calibrationCandidates.length) {
      setSetupStep(3);
    }
  };

  const handleMore = (item: DigestItem) => {
    const alreadyMore = (signals.moreIds || []).includes(item.id);
    const existingFeedback = semanticFeedback.find(entry => entry.id === item.id);
    if (alreadyMore && existingFeedback?.vote === 'like') {
      setSignals(prev => ({
        ...prev,
        moreIds: (prev.moreIds || []).filter(id => id !== item.id),
        moreTopics: [],
        lessTopics: [],
        more: [],
        less: [],
      }));
      removeSemanticFeedback(item.id);
      showToast('Undone — this story is back to unrated');
      return;
    }
    if (alreadyMore) {
      setSignals(prev => ({
        ...prev,
        lessIds: (prev.lessIds || []).filter(id => id !== item.id),
        moreTopics: [],
        lessTopics: [],
        more: [],
        less: [],
      }));
      recordSemanticFeedback(item, 'like');
      showToast('More like this — noted for your next edition');
      return;
    }

    setSignals(prev => ({
      ...prev,
      moreIds: Array.from(new Set([...(prev.moreIds || []), item.id])),
      lessIds: (prev.lessIds || []).filter(id => id !== item.id),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));
    recordSemanticFeedback(item, 'like');
    showToast('More like this — noted for your next edition');
  };

  const handleLess = (item: DigestItem) => {
    const isAlreadyLess = (signals.lessIds || []).includes(item.id);
    const existingFeedback = semanticFeedback.find(entry => entry.id === item.id);
    if (isAlreadyLess && !mutedCards[item.id]) {
      if (existingFeedback?.vote === 'dislike') {
        undoHandleLess(item.id);
      } else {
        recordSemanticFeedback(item, 'dislike');
        showToast('Less like this — noted for your next edition');
      }
      return;
    }

    setSignals(prev => ({
      ...prev,
      lessIds: Array.from(new Set([...(prev.lessIds || []), item.id])),
      moreIds: (prev.moreIds || []).filter(id => id !== item.id),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));
    recordSemanticFeedback(item, 'dislike');

    // Retain in mutedCards so the card slot shows an inline Undo fallback
    setMutedCards(prev => ({
      ...prev,
      [item.id]: item
    }));

    showToast(`Less like this · "${item.title}" hidden`, 'Undo this story', () => undoHandleLess(item.id));
  };

  const undoHandleLess = (itemId: string) => {
    const item = mutedCards[itemId] || digest.find(d => d.id === itemId) || feedStreamArticles.find(d => d.id === itemId);

    setMutedCards(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    removeSemanticFeedback(itemId);

    setSignals(prev => ({
      ...prev,
      lessIds: (prev.lessIds || []).filter(id => id !== itemId),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));

    showToast(item ? `"${item.title}" is back in your digest` : 'Story restored to your digest');
  };

  const permanentlyDismissMuted = (itemId: string) => {
    setMutedCards(prev => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    setDigest(prev => prev.filter(d => d.id !== itemId));
  };

  const handleSave = (item: DigestItem) => {
    const isSaved = savedIds.includes(item.id);
    if (isSaved) {
      setSavedIds(prev => prev.filter(id => id !== item.id));
      setSavedArticles(prev => prev.filter(a => a.id !== item.id));
      showToast('Removed from saved items', 'Undo', () => {
        setSavedIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
        setSavedArticles(prev => [item, ...prev.filter(a => a.id !== item.id)]);
      });
    } else {
      setSavedIds(prev => [...prev, item.id]);
      setSavedArticles(prev => [item, ...prev.filter(a => a.id !== item.id)]);
      showToast('Saved to your reading queue');
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = newSourceTitle.trim();
    const trimmedUrl = newSourceUrl.trim();
    // Novalidate on the form means iOS Safari, which shows no native message for a bad
    // type="url" value, still reaches this handler and gets the inline error below.
    if (!trimmedTitle) {
      setNewSourceTitleError('Give the source a name, e.g. "Marginal Revolution".');
      return;
    }
    setNewSourceTitleError(null);
    if (!trimmedUrl) {
      setNewSourceUrlError('A feed URL is required — it is where Curator fetches new stories.');
      return;
    }
    if (!/^https?:\/\/(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|\S+\.\S+)/i.test(trimmedUrl)) {
      setNewSourceUrlError(`"${trimmedUrl}" does not look like a valid feed URL. Start with http:// or https:// and include a domain, e.g. https://example.com/feed.xml.`);
      return;
    }
    setNewSourceUrlError(null);
    // A source is only "active" once Curator has actually read it: a URL that returns 404,
    // a login page or an HTML article used to be added and then quietly fail in every digest.
    setNewSourceValidating(true);
    let feedItemCount = 0;
    try {
      const check = await fetch('/api/check-feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl: trimmedUrl })
      });
      const checkData = await check.json().catch(() => ({}));
      if (!check.ok || !checkData?.ok) {
        setNewSourceUrlError(
          checkData?.error
            ? `Curator could not read that feed: ${String(checkData.error)}.`
            : 'Curator could not read that feed. Check the address serves RSS or Atom.'
        );
        return;
      }
      feedItemCount = Number(checkData.itemCount) || 0;
    } catch {
      setNewSourceUrlError('Could not reach the server to check that feed. Try again in a moment.');
      return;
    } finally {
      setNewSourceValidating(false);
    }

    const requestedFolder = newSourceFolder.trim();
    const chosenFolder = sources
      .map(src => displayFolder(src.folder))
      .find(folder => folder.toLowerCase() === requestedFolder.toLowerCase()) || requestedFolder || 'General';
    const newSrc: SourceItem = {
      id: 'src_' + Date.now(),
      title: trimmedTitle,
      feedUrl: trimmedUrl,
      folder: chosenFolder,
      categories: [chosenFolder],
      status: 'active'
    };
    setSources(prev => [newSrc, ...prev]);
    setNewSourceFolder(newSrc.folder);
    setNewSourceFolderCustom(false);
    setNewSourceTitle('');
    setNewSourceUrl('');
    setShowAddSourceModal(false);
    showToast(`Added "${trimmedTitle}" · ${feedItemCount} recent ${feedItemCount === 1 ? 'story' : 'stories'} found`);
  };

  const toggleSourceCategory = (sourceId: string, category: string) => {
    setSources(prev => prev.map(source => {
      if (source.id !== sourceId) return source;
      const categories = normalizeCategoryLabels(source.categories, source.folder);
      const isSelected = categories.some(value => value.toLowerCase() === category.toLowerCase());
      return {
        ...source,
        categories: isSelected
          ? categories.filter(value => value.toLowerCase() !== category.toLowerCase())
          : [...categories, category],
      };
    }));
  };

  const addSourceCategory = (source: SourceItem) => {
    const typed = categoryDraft.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!typed) return;
    const category = sourceCategories.find(value => value.toLowerCase() === typed.toLowerCase()) || typed;
    setSources(prev => prev.map(item => {
      if (item.id !== source.id) return item;
      const categories = normalizeCategoryLabels(item.categories, item.folder);
      if (categories.some(value => value.toLowerCase() === category.toLowerCase())) return item;
      return { ...item, categories: [...categories, category] };
    }));
    setCategoryDraft('');
  };

  const handleDeleteSource = (id: string) => {
    if (pendingDeleteId !== id) {
      setPendingDeleteId(id);
      showToast('Tap the trash again to confirm removal');
      return;
    }
    setPendingDeleteId(null);
    const removed = sources.find(s => s.id === id);
    setSources(prev => prev.filter(s => s.id !== id));
    showToast(
      `Removed "${removed?.title ?? 'source'}"`,
      'Undo',
      () => {
        if (removed) setSources(prev => (prev.some(s => s.id === removed.id) ? prev : [removed, ...prev]));
      }
    );
  };

  const processOpmlText = async (rawText: string, options?: { skipConfirm?: boolean }) => {
    if (!rawText.trim()) return;
    // Importing merges, so an existing list is never replaced — but say so before the first file.
    if (!options?.skipConfirm && sources.length > 0) {
      setPendingImportText(rawText);
      return;
    }
    setIsImportingOpml(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/parse-opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opmlText: rawText })
      });
      const responseText = await res.text();
      let data: any = null;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        // The server may return a non-JSON error page, such as for an oversized request.
      }
      if (!res.ok) {
        setImportError(res.status === 413
          ? 'This OPML file is too large to import. Try a smaller export.'
          : data?.error || `Could not parse subscription file (HTTP ${res.status}).`);
        return;
      }
      if (!data || typeof data !== 'object') {
        setImportError('The OPML import service returned an invalid response. Please try again.');
        return;
      }
      if (data.success && data.sources) {
        const known = new Set(sources.map(source => normalizeFeedUrl(source.feedUrl)));
        const added: SourceItem[] = [];
        let duplicates = 0;
        for (const source of data.sources as SourceItem[]) {
          const key = normalizeFeedUrl(source.feedUrl);
          if (!key || known.has(key)) {
            duplicates += 1;
            continue;
          }
          known.add(key);
          added.push({
            ...source,
            id: `src_${Date.now()}_${added.length}_${Math.random().toString(36).slice(2, 6)}`,
            categories: normalizeCategoryLabels(source.categories, source.folder),
          });
        }
        if (added.length > 0) setSources(prev => [...added, ...prev]);
        setImportResult({
          totalImported: added.length,
          successCount: added.filter(source => source.status !== 'failing').length,
          failCount: added.filter(source => source.status === 'failing').length,
          duplicates,
          failures: data.failures || []
        });
        showToast(
          added.length === 0
            ? `No new feeds — ${duplicates === 1 ? 'the only feed in that file is' : `all ${duplicates} feeds are`} already in your list`
            : `Added ${added.length} ${added.length === 1 ? 'feed' : 'feeds'}${duplicates > 0 ? ` · ${duplicates} already in your list` : ''}`
        );
      }
    } catch (e) {
      setImportError('Unable to reach the OPML import service. Please try again.');
    } finally {
      setIsImportingOpml(false);
    }
  };

  const handleImportOPML = async () => {
    await processOpmlText(importText);
  };

  const handleOpmlFileSelected = async (file: File) => {
    setImportFileName(file.name);
    setImportError(null);
    try {
      const text = await file.text();
      setImportText(text);
      await processOpmlText(text);
    } catch (e) {
      setImportError('Could not read the selected file.');
    }
  };

  const openImportModal = () => {
    setImportError(null);
    setImportResult(null);
    setImportFileName(null);
    setPendingImportText(null);
    setShowImportModal(true);
  };

  const handleDiscoverSources = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = discoverQuery.trim();
    if (!q) return;

    setIsDiscovering(true);
    setDiscoverError(null);
    setHasSearchedSources(true);
    try {
      const res = await fetch('/api/discover-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, apiKey: customApiKey })
      });
      const data = await res.json();
      if (!res.ok) {
        setDiscoverError(data.error || 'Search failed.');
        setDiscoverResults([]);
        setDiscoverGroundingLinks([]);
        return;
      }
      setDiscoverResults(Array.isArray(data.results) ? data.results : []);
      setDiscoverGroundingLinks(Array.isArray(data.groundingLinks) ? data.groundingLinks : []);
    } catch (err) {
      setDiscoverError('Could not reach the search service.');
      setDiscoverResults([]);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleAddDiscoveredSource = (item: DiscoveredSource) => {
    if (!item.feedUrl) return;
    const normalizedFeedUrl = item.feedUrl.trim().toLowerCase();
    const alreadyExists = sources.some(s => s.feedUrl.trim().toLowerCase() === normalizedFeedUrl);
    if (alreadyExists) {
      showToast(`"${item.title}" is already in your sources`);
      return;
    }

    const newSrc: SourceItem = {
      id: 'src_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: item.title,
      feedUrl: item.feedUrl,
      folder: item.folder || 'Discovered',
      categories: [item.folder || 'Discovered'],
      status: 'active'
    };
    setSources(prev => [newSrc, ...prev]);
    showToast(
      item.rssStatus === 'generatable'
        ? `Generated RSS and added "${item.title}"`
        : `Added "${item.title}" to ${newSrc.folder}`
    );
  };

  const handleExportOPML = () => {
    const escapeXmlAttribute = (value: string) => value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head>
    <title>Curator Subscriptions Export</title>
  </head>
  <body>
    ${sources.map(s => `<outline text="${escapeXmlAttribute(s.title)}" title="${escapeXmlAttribute(s.title)}" type="rss" xmlUrl="${escapeXmlAttribute(s.feedUrl)}" category="${escapeXmlAttribute(s.folder)}" curatorCategories="${escapeXmlAttribute(JSON.stringify(normalizeCategoryLabels(s.categories, s.folder)))}"/>`).join('\n    ')}
  </body>
</opml>`;
    const blob = new Blob([opmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'curator_subscriptions.opml';
    a.click();
    showToast('Subscription list exported successfully');
  };

  // A site that publishes nothing larger than a 16×16 icon has no sharper copy to fetch, so
  // stretching it to card size is what made it look blurred. Marked here, drawn as crisp
  // pixels by CSS.
  const markTinyIcon = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalWidth < 48) image.dataset.tinyIcon = 'true';
  };

  const getSourceAvatar = (feedUrl?: string): string | undefined => {
    if (!feedUrl) return undefined;
    let hostname: string | undefined;
    try {
      const url = new URL(feedUrl);
      hostname = url.hostname;
      // A scraped publication is stored as our own generated-feed link, so the icon has to be
      // asked for using the site it wraps rather than this host.
      if (/\/api\/generated-feed$/.test(url.pathname)) {
        const target = url.searchParams.get('url');
        if (target) hostname = new URL(target).hostname;
      }
    } catch (e) {
      return undefined;
    }
    if (!hostname || !hostname.includes('.')) return undefined;
    // Served by our own server and cached there: no third-party request per card. The version
    // is part of the URL so a browser that cached a small icon before the server learned to
    // look for a sharper one asks again instead of keeping the blurry copy for a week.
    return `/api/favicon?domain=${encodeURIComponent(hostname)}&v=2`;
  };

  const formatSyncTime = (timestamp?: number): string => {
    if (!timestamp) return 'Not synced yet';
    const diff = Math.max(0, Date.now() - timestamp);
    if (diff < 60 * 1000) return 'Just now';
    const mins = Math.floor(diff / (60 * 1000));
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // "4 min ago · Nov 20": how long ago the edition was built, then its date, so nobody has to
  // work out whether "Nov 20 at 6:03 AM" is today. The year only appears when it differs.
  const formatCuratedAt = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return '';
    const d = new Date(value);
    // Always carry the year: an edition can be months old, and "Nov 17" on its own is a guess.
    const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    const relative = formatSyncTime(value);
    return `${relative === 'Just now' ? 'just now' : relative} · ${date}`;
  };

  // Pounds, with enough precision that a few tenths of a penny still show
  const formatGbp = (value: number): string => {
    const safe = Number.isFinite(value) ? value : 0;
    if (safe === 0) return '0.00';
    return safe < 0.01 ? safe.toFixed(4) : safe.toFixed(2);
  };

  const formatTokens = (value: number): string => {
    const safe = Number.isFinite(value) ? value : 0;
    if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(2)}M`;
    if (safe >= 1000) return `${(safe / 1000).toFixed(1)}k`;
    return String(Math.round(safe));
  };

  const getShortSourceTitle = (title: string): string => {
    if (!title) return '';
    let clean = title.trim();
    // Strip leading articles and honorifics
    clean = clean.replace(/^(the|a|an)\s+/i, '');
    clean = clean.replace(/^dr\.?\s+/i, '');

    // Canonical source abbreviations for concise circle labels
    if (/^Stratechery/i.test(clean)) return 'Stratechery';
    if (/^Marginal Revolution/i.test(clean)) return 'Marginal Rev';
    if (/^World Politics/i.test(clean)) return 'World History';
    if (/^Long Now/i.test(clean)) return 'Long Now';
    if (/^Rest of World/i.test(clean)) return 'Rest of World';
    if (/^Dan Luu/i.test(clean)) return 'Dan Luu';
    if (/^List Apart/i.test(clean)) return 'List Apart';
    if (/^Anthropic/i.test(clean)) return 'Anthropic';
    if (/^Nicole Williams/i.test(clean)) return 'Nicole W.';
    if (/^Prospect/i.test(clean)) return 'Prospect';
    if (/^Bhaskar/i.test(clean)) return 'Bhaskar';

    const parts = clean.split(/\s+/);
    if (parts.length >= 2 && (parts[0].length + parts[1].length) <= 12) {
      return `${parts[0]} ${parts[1]}`;
    }
    return parts[0];
  };

  const handleRefreshSource = async (source: SourceItem) => {
    setRefreshingSourceId(source.id);
    try {
      // The id is exact; the title is only a fallback for older saved sources without one, and
      // force skips the server's five-minute feed cache so this is a real re-read.
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.id, sourceTitle: source.title, sources, force: true })
      });
      const data = await res.json().catch(() => ({}));
      const articles: DigestItem[] = Array.isArray(data.articles) ? data.articles : [];
      const fetched = res.ok && articles.length > 0;
      if (fetched) applySourceMetadata(articles);

      setSources(prev => prev.map(s => {
        if (s.id !== source.id) return s;
        return fetched
          ? { ...s, lastSyncedAt: Date.now(), status: 'active' as const, failingReason: undefined }
          : {
              ...s,
              status: 'failing' as const,
              failingReason: res.ok ? 'This feed returned no articles.' : (data.error || `Feed returned HTTP ${res.status}.`)
            };
      }));

      if (fetched) {
        if (selectedFeedSource === source.title) {
          setFeedStreamArticles(articles);
          setFeedStreamRenderKey(prev => prev + 1);
        }
        showToast(`Fetched ${articles.length} ${articles.length === 1 ? 'article' : 'articles'} from "${source.title}"`);
      } else {
        showToast(`Could not refresh "${source.title}"`);
      }
    } catch (e) {
      setSources(prev => prev.map(s => s.id === source.id
        ? { ...s, status: 'failing' as const, failingReason: 'Network error while refreshing this feed.' }
        : s));
      showToast(`Could not refresh "${source.title}"`);
    } finally {
      setRefreshingSourceId(null);
    }
  };

  const failingSourceCount = sources.filter(s => s.status === 'failing').length;

  // Re-read every watched feed — and only the feeds. It never rebuilds the digest, so a refresh
  // here cannot reshuffle what is waiting on the Today page.
  const handleRefreshAllFeeds = async () => {
    if (refreshingAllFeeds) return;
    setRefreshingAllFeeds(true);
    try {
      const res = await fetch('/api/feed-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceTitle: selectedFeedSource || 'all',
          sources,
          refreshAll: true,
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Could not refresh your feeds');
        return;
      }

      const articles: DigestItem[] = Array.isArray(data.articles) ? data.articles : [];
      const results: Array<{ id?: string; title?: string; ok?: boolean; itemCount?: number; error?: string }> =
        Array.isArray(data.sources) ? data.sources : [];

      if (results.length > 0) {
        // The server reports one row per feed, so a source is only marked healthy when it
        // actually answered with articles.
        setSources(prev => prev.map(src => {
          const result = results.find(row =>
            (row.id && row.id === src.id) ||
            String(row.title || '').trim().toLowerCase() === src.title.trim().toLowerCase()
          );
          if (!result) return src;
          return result.ok
            ? { ...src, lastSyncedAt: Date.now(), status: 'active' as const, failingReason: undefined }
            : { ...src, status: 'failing' as const, failingReason: result.error || 'This feed returned no articles.' };
        }));
      }

      applySourceMetadata(articles);
      setFeedStreamArticles(articles);
      setFeedStreamRenderKey(prev => prev + 1);

      if (results.length > 0) {
        const answered = results.filter(row => row.ok).length;
        showToast(
          answered === results.length
            ? `Refreshed all ${results.length} feeds`
            : `Refreshed ${answered} of ${results.length} feeds — the rest did not answer`
        );
      } else {
        showToast(`Refreshed ${articles.length} ${articles.length === 1 ? 'entry' : 'entries'}`);
      }
    } catch (e) {
      showToast('Could not refresh your feeds');
    } finally {
      setRefreshingAllFeeds(false);
    }
  };

  const releaseWakeLock = () => {
    wakeLockWantedRef.current = false;
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && typeof lock.release === 'function') {
      try {
        lock.release();
      } catch {
        // already released by the browser
      }
    }
  };

  const requestWakeLock = async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockRef.current) return;
    wakeLockWantedRef.current = true;
    try {
      const lock = await (navigator as any).wakeLock.request('screen');
      if (!wakeLockWantedRef.current) {
        // Playback stopped while the request was in flight
        try { lock.release(); } catch { /* ignore */ }
        return;
      }
      wakeLockRef.current = lock;
      // The browser releases the lock automatically when the page is hidden
      lock.addEventListener?.('release', () => {
        if (wakeLockRef.current === lock) wakeLockRef.current = null;
      });
    } catch {
      // Denied (e.g. Low Power Mode) or unsupported — playback continues normally
    }
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      // Locks are dropped on tab switch; re-acquire only if audio is still running unattended
      if (document.visibilityState === 'visible' && speechPlaying && !speechPaused) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [speechPlaying, speechPaused]);

  // Release the wake lock only when the app itself goes away
  useEffect(() => () => releaseWakeLock(), []);

  // ---- Read Aloud -------------------------------------------------------------
  // One utterance per sentence, queued: short utterances never hit the engine's
  // long-string truncation (Chrome stops at roughly fifteen seconds, iOS stalls on very
  // long strings), paragraph breaks get a longer beat than sentence breaks, and the queue
  // position is the progress indicator.

  const configureSpeechUtterance = (utterance: SpeechSynthesisUtterance) => {
    // getVoices() can still be empty on the first read after mount, so ask it again here:
    // the very first sentence should already use the chosen voice, not the system default.
    const voice = activeSpeechVoice || (
      typeof window !== 'undefined' && 'speechSynthesis' in window
        ? resolveSpeechVoice(window.speechSynthesis.getVoices() || [], speechVoiceUri)
        : null
    );
    // With no better voice identified, neither the voice nor the language is touched, so the
    // device speaks with the voice chosen in Spoken Content — Jamie (Premium), here.
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || SPEECH_FALLBACK_LANG;
    }
    utterance.rate = speechRate;
  };

  const stopSpeech = () => {
    speechSessionRef.current += 1;
    speechStateRef.current = 'idle';
    if (speechGapTimerRef.current) {
      clearTimeout(speechGapTimerRef.current);
      speechGapTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    speechQueueRef.current = [];
    speechIndexRef.current = 0;
    speechArticleIdRef.current = null;
    speechArticleItemRef.current = null;
    speechUtteranceRef.current = null;
    releaseWakeLock();
    setSpeechPlaying(false);
    setSpeechPaused(false);
    setSpeechArticleId(null);
    setSpeechProgress({ index: 0, total: 0, paragraph: -1 });
  };

  // Only a queue that ran to its end counts as listening; stopSpeech() is the other exit
  const finishSpeech = () => {
    const finishedId = speechArticleIdRef.current;
    const finishedArticle = speechArticleItemRef.current;
    stopSpeech();
    if (!finishedId) return;
    setReadingStats(prev => ({
      ...prev,
      [finishedId]: { maxDepth: 100, finished: true, lastRead: Date.now() }
    }));
    setReadArticleIds(prev => (prev.includes(finishedId) ? prev : [...prev, finishedId]));
    // A listen that ran to the end is reading time, so it belongs in the weekly review too.
    if (finishedArticle) {
      const minutes = parseInt(finishedArticle.readTime, 10) || 0;
      setWeeklyHistory(prev => {
        if (prev.some(it => it.id === finishedArticle.id)) return prev;
        return [{
          id: finishedArticle.id,
          title: finishedArticle.title,
          source: finishedArticle.source,
          folder: finishedArticle.folder,
          readTime: finishedArticle.readTime,
          minutesSpent: minutes,
          completedAt: Date.now(),
          url: finishedArticle.url
        }, ...prev];
      });
    }
    showToast('Finished listening · Read through recorded');
  };

  const speakSpeechChunk = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const queue = speechQueueRef.current;
    const index = speechIndexRef.current;
    const session = speechSessionRef.current;

    if (index >= queue.length) {
      finishSpeech();
      return;
    }

    const chunk = queue[index];
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    configureSpeechUtterance(utterance);

    speechStateRef.current = 'playing';
    setSpeechPlaying(true);
    setSpeechPaused(false);
    setSpeechProgress({ index, total: queue.length, paragraph: chunk.paragraphIndex });

    utterance.onstart = () => {
      speechStartedRef.current = true;
      setSpeechPlaying(true);
      setSpeechPaused(false);
    };

    utterance.onend = () => {
      if (session !== speechSessionRef.current) return;
      if (speechStateRef.current === 'idle') return;

      speechUtteranceRef.current = null;
      speechIndexRef.current = index + 1;
      const next = queue[index + 1];
      const endsParagraph = Boolean(next) && chunk.paragraphIndex >= 0 && next.paragraphIndex !== chunk.paragraphIndex;

      speechGapTimerRef.current = setTimeout(() => {
        speechGapTimerRef.current = null;
        if (session !== speechSessionRef.current) return;
        // Paused inside the gap: resume() picks the queue back up
        if (speechStateRef.current !== 'playing') return;
        speakSpeechChunk();
      }, endsParagraph ? SPEECH_PARAGRAPH_PAUSE_MS : SPEECH_SENTENCE_PAUSE_MS);
    };

    utterance.onerror = (event) => {
      if (session !== speechSessionRef.current) return;
      const reason = String(event?.error || '');
      // A cancelled or superseded utterance is not a failure worth reporting
      if (reason === 'interrupted' || reason === 'canceled' || reason === 'cancelled') return;
      console.warn('SpeechSynthesis error:', event);
      stopSpeech();
      showToast('Read aloud stopped — this voice could not speak that passage.');
    };

    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const startSpeech = (article: DigestItem, startIndex = 0) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Speech audio is not supported in this browser.');
      return;
    }

    const queue = buildSpeechQueue(article);
    if (queue.length === 0) {
      showToast('This article has no readable text to speak.');
      return;
    }

    stopSpeech();
    const first = Math.max(0, Math.min(startIndex, queue.length - 1));
    speechQueueRef.current = queue;
    speechIndexRef.current = first;
    speechArticleIdRef.current = article.id;
    speechArticleItemRef.current = article;
    speechStartedRef.current = false;
    setSpeechArticleId(article.id);
    setSpeechProgress({ index: first, total: queue.length, paragraph: queue[first].paragraphIndex });
    requestWakeLock();
    // Still inside the tap: iOS only starts speaking from a user gesture
    speakSpeechChunk();

    // If the engine never started, say so instead of leaving a bar that never moves
    const session = speechSessionRef.current;
    setTimeout(() => {
      if (speechSessionRef.current !== session) return;
      if (speechStartedRef.current) return;
      stopSpeech();
      showToast('The device did not start speaking — try Read aloud again.');
    }, SPEECH_START_GRACE_MS);
  };

  const pauseSpeech = () => {
    if (speechStateRef.current !== 'playing') return;
    if (speechGapTimerRef.current) {
      clearTimeout(speechGapTimerRef.current);
      speechGapTimerRef.current = null;
    }
    speechStateRef.current = 'paused';
    setSpeechPaused(true);
    releaseWakeLock();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
    }
    showToast('Paused reading aloud');
  };

  const resumeSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (speechStateRef.current !== 'paused') return;

    speechStateRef.current = 'playing';
    setSpeechPaused(false);
    requestWakeLock();
    showToast('Resumed reading aloud');

    // pause() marks the engine paused even with nothing queued, so always clear it first
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    // Paused in the breath between two sentences: nothing is loaded with the engine
    if (!speechUtteranceRef.current) speakSpeechChunk();
  };

  const handleToggleReadAloud = (article: DigestItem) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Speech audio is not supported in this browser.');
      return;
    }

    const isThisArticle = speechArticleIdRef.current === article.id;
    if (isThisArticle && speechStateRef.current === 'paused') {
      resumeSpeech();
      return;
    }
    if (isThisArticle && speechStateRef.current === 'playing') {
      pauseSpeech();
      return;
    }
    startSpeech(article);
  };

  const handleStopReadAloud = () => stopSpeech();

  // Tapping a paragraph while listening restarts the queue at that paragraph
  const jumpSpeechToParagraph = (paragraphIndex: number) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const at = speechQueueRef.current.findIndex(chunk => chunk.paragraphIndex === paragraphIndex);
    if (at === -1) return;

    speechSessionRef.current += 1;
    speechStateRef.current = 'idle';
    if (speechGapTimerRef.current) {
      clearTimeout(speechGapTimerRef.current);
      speechGapTimerRef.current = null;
    }
    window.speechSynthesis.cancel();
    speechIndexRef.current = at;
    requestWakeLock();
    speakSpeechChunk();
  };

  // Settings › Read aloud › Hear this voice
  const handlePreviewSpeech = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Speech audio is not supported in this browser.');
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance('Curator. Your morning reading, read aloud.');
    configureSpeechUtterance(utterance);
    window.speechSynthesis.speak(utterance);
    showToast(`Trying ${speechVoiceLabel} at ${speechRate.toFixed(2)}×`);
  };

  // Leaving the article ends the session, so speech never reads a page the reader closed
  useEffect(() => {
    const sessionArticleId = speechArticleIdRef.current;
    if (!sessionArticleId) return;
    if (selectedArticle && selectedArticle.id === sessionArticleId) return;
    stopSpeech();
  }, [selectedArticle]);

  // Follow the voice down the page, but only once the spoken paragraph has scrolled away
  useEffect(() => {
    if (!speechPlaying || speechProgress.paragraph < 0) return;
    const element = document.getElementById(`reader-paragraph-${speechProgress.paragraph}`);
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 88 && rect.bottom <= window.innerHeight - 48) return;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [speechPlaying, speechProgress.paragraph]);

  const getCardActions = (itemId: string) => {
    const stats = readingStats[itemId] || {};

    const isReadThrough = Boolean(stats?.maxDepth && stats.maxDepth >= READ_THROUGH_DEPTH);
    // Older builds also marked articles read when their original link was merely tapped.
    // Only show Opened when there is a matching in-reader timestamp or reading progress.
    const hasReaderOpenRecord = readArticleIds.includes(itemId) && Boolean(stats?.lastRead);
    const isClicked = hasReaderOpenRecord || Boolean(stats?.maxDepth && stats.maxDepth > 0);
    const isVotedMore = Boolean(signals.moreIds?.includes(itemId));
    const isVotedLess = Boolean(signals.lessIds?.includes(itemId));
    const isSaved = savedIds.includes(itemId);

    const hasAnyAction = isReadThrough || isClicked || isVotedMore || isVotedLess || isSaved;

    const actionTags: Array<{ label: string; color: 'emerald' | 'amber' | 'rose' | 'sky' | 'purple' }> = [];

    if (isReadThrough) {
      actionTags.push({ label: 'Read through', color: 'emerald' });
    } else if (isClicked) {
      const depth = stats?.maxDepth ? `${stats.maxDepth}% read` : 'Opened in Curator';
      actionTags.push({ label: depth, color: 'sky' });
    }

    if (isVotedMore) {
      actionTags.push({ label: 'More like this', color: 'amber' });
    } else if (isVotedLess) {
      actionTags.push({ label: 'Less like this', color: 'rose' });
    }

    if (isSaved) {
      actionTags.push({ label: 'Saved', color: 'amber' });
    }

    return {
      hasAnyAction,
      isReadThrough,
      isClicked,
      isVotedMore,
      isVotedLess,
      isSaved,
      actionTags,
      summaryText: actionTags.length > 0 ? actionTags.map(t => t.label).join(' · ') : 'None',
    };
  };

  // The reader owns browser history entries (one per open), so the phone's back gesture
  // closes the article instead of leaving the site.
  const readerHistoryDepthRef = React.useRef(0);
  const readerCloseButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const readerReturnFocusRef = React.useRef<HTMLElement | null>(null);
  const readerAppearanceRef = React.useRef<HTMLDivElement | null>(null);
  const readerAppearanceButtonRef = React.useRef<HTMLButtonElement | null>(null);

  // One refresh attempt per article per session: a failed fetch leaves the stored body alone and
  // is retried when the piece is next opened, not on every render.
  const articleLinkRefreshRef = React.useRef<Set<string>>(new Set());

  // A piece saved before the cleaner kept links has only the link's words in its stored text, so
  // the article is fetched once and the refreshed body replaces the copy in the queue.
  const refreshArticleLinks = async (item: DigestItem) => {
    if (articleLinkRefreshRef.current.has(item.id)) return;
    articleLinkRefreshRef.current.add(item.id);
    try {
      const response = await fetch('/api/article-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url }),
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      const text = typeof data?.text === 'string' ? data.text : '';
      // Short text means the extractor found the page's chrome rather than the piece, so the
      // stored body stays the better read.
      if (text.length < 200) return;
      const refreshedAt = Date.now();
      const upgrade = (entry: DigestItem): DigestItem => entry.id === item.id
        ? { ...entry, fullText: text, linksCleaned: true, linkRefreshAt: refreshedAt }
        : entry;
      setSelectedArticle(prev => (prev && prev.id === item.id ? upgrade(prev) : prev));
      setSavedArticles(prev => prev.map(upgrade));
      setDigest(prev => prev.map(upgrade));
      // The Feeds stream holds the same story under the same id, and opening it from there within
      // this session must not fall back to the body that predates the refresh.
      setFeedStreamArticles(prev => prev.map(upgrade));
    } catch {
      // Offline, or the article is gone: the saved text still reads, and the next open retries.
    }
  };

  const [readerScrollProgress, setReaderScrollProgress] = useState(0);
  const [linkRefreshProgress, setLinkRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  // Stopping mid-queue aborts the request in flight and the loop that follows it; pieces already
  // written stay written, so pressing the button again picks up the rest.
  const linkRefreshAbortRef = React.useRef<AbortController | null>(null);

  // The whole queue can be upgraded at once, so a piece is not left without its citations just
  // because it was never reopened. The server reads a batch at a time through the same cache the
  // digest uses, and only a body long enough to be the article replaces the stored copy.
  const refreshSavedQueueLinks = async () => {
    if (linkRefreshProgress) return;
    const queue = savedArticles.filter(articleNeedsLinkRefresh);
    if (queue.length === 0) {
      showToast('Every saved piece already carries its links');
      return;
    }
    setLinkRefreshProgress({ done: 0, total: queue.length });
    const controller = new AbortController();
    linkRefreshAbortRef.current = controller;
    let upgraded = 0;
    let completed = true;
    // A stop lands either between batches (the loop breaks) or inside one (the aborted request
    // throws), so both paths report the same thing: what was written before the stop.
    const reportStop = () => showToast(upgraded > 0
      ? `Stopped — citations added to ${upgraded} saved ${upgraded === 1 ? 'piece' : 'pieces'}`
      : 'Stopped adding citations');
    try {
      // Eight at a time: enough to keep the server's four extractors busy, small enough that the
      // bar moves every few seconds on a long queue.
      for (let start = 0; start < queue.length; start += 8) {
        if (controller.signal.aborted) break;
        const batch = queue.slice(start, start + 8);
        const response = await fetch('/api/article-texts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: batch.map(({ id, url }) => ({ id, url })) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          completed = false;
          break;
        }
        const data = await response.json().catch(() => ({}));
        const accepted = new Map<string, string>();
        const attempted = new Set<string>();
        for (const entry of Array.isArray(data?.articles) ? data.articles : []) {
          const id = typeof entry?.id === 'string' ? entry.id : '';
          if (!id) continue;
          attempted.add(id);
          const text = typeof entry?.text === 'string' ? entry.text : '';
          // Short text means the extractor found the page's chrome or a paywall, so the stored
          // body stays the better read.
          if (text.length >= 200) accepted.set(id, text);
        }
        upgraded += accepted.size;
        if (attempted.size > 0) {
          const refreshedAt = Date.now();
          const applyBatch = (entry: DigestItem): DigestItem => {
            if (!attempted.has(entry.id)) return entry;
            const text = accepted.get(entry.id);
            // A piece the server could not read (a dead page, a paywall) keeps its stored body;
            // the stamp records that this pass asked, so the count does not sit at one forever.
            return text
              ? { ...entry, fullText: text, linksCleaned: true, linkRefreshAt: refreshedAt }
              : { ...entry, linkRefreshAt: refreshedAt };
          };
          setSelectedArticle(prev => (prev ? applyBatch(prev) : prev));
          setSavedArticles(prev => prev.map(applyBatch));
          setDigest(prev => prev.map(applyBatch));
          setFeedStreamArticles(prev => prev.map(applyBatch));
        }
        setLinkRefreshProgress({ done: Math.min(start + batch.length, queue.length), total: queue.length });
      }
      if (controller.signal.aborted) {
        reportStop();
      } else if (!completed) {
        showToast('The queue was only partly refreshed — try again in a moment');
      } else if (upgraded === 0) {
        showToast('No citations could be added just now');
      } else {
        showToast(`Added citations to ${upgraded} saved ${upgraded === 1 ? 'piece' : 'pieces'}`);
      }
    } catch {
      if (controller.signal.aborted) reportStop();
      else showToast('Could not reach the server to add citations');
    } finally {
      linkRefreshAbortRef.current = null;
      setLinkRefreshProgress(null);
    }
  };

  const stopSavedQueueLinks = () => {
    linkRefreshAbortRef.current?.abort();
  };

  const openArticle = (item: DigestItem) => {
    setSelectedArticle(item);
    // A new piece starts at the top, so the progress line starts empty.
    setReaderScrollProgress(0);
    // The byline's source description starts collapsed on every article, and so does the
    // appearance menu — opening a new article should never inherit an open popover.
    setShowReaderSourceNote(false);
    setShowReaderAppearance(false);

    // Mark article as read / clicked
    setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));

    // Update reading stats
    setReadingStats(prev => {
      const current = prev[item.id] || { maxDepth: 0, finished: false };
      return {
        ...prev,
        [item.id]: {
          ...current,
          lastRead: Date.now()
        }
      };
    });

    // Mark corresponding source as read to dismiss its orange dot immediately
    const match = sources.find(
      s => s.title.toLowerCase() === item.source.toLowerCase() ||
           item.source.toLowerCase().includes(s.title.toLowerCase())
    );
    if (match && !readSourceIds.includes(match.id)) {
      setReadSourceIds(prev => [...prev, match.id]);
    }

    if (articleNeedsLinkRefresh(item)) void refreshArticleLinks(item);

    window.history.pushState({ curatorReader: true }, '');
    readerHistoryDepthRef.current += 1;
  };

  // The reader opens from Today, Feeds or Saved and never changes the tab underneath, so the
  // way back should name the page the reader actually came from.
  const readerBackLabel = activeTab === 'feeds'
    ? 'Back to Feeds'
    : activeTab === 'saved'
      ? 'Back to Saved'
      : 'Back to Digest';

  const backgroundInert = Boolean(selectedArticle)
    || showAddSourceModal
    || showImportModal
    || showSetupWizard
    || showWeeklyReviewModal
    || showDigestSettings;

  const closeArticle = () => {
    if (readerHistoryDepthRef.current > 0 && window.history.state?.curatorReader) {
      // Consuming the pushed entry fires popstate, which does the actual close below —
      // one back press equals one close, even when articles were opened on top of each other.
      window.history.back();
      return;
    }
    handleStopReadAloud();
    setSelectedArticle(null);
  };

  // Browser back while the reader is open closes the article; Escape closes it too, and
  // focus moves into the dialog on open and back to the trigger on close.
  React.useEffect(() => {
    const onPopState = () => {
      if (readerHistoryDepthRef.current > 0) {
        readerHistoryDepthRef.current -= 1;
        // Clearing the article also stops read-aloud via the session effect above.
        setSelectedArticle(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeArticle();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  // The Aa menu is a small popover inside the reading header: a tap anywhere else or Escape
  // closes it, and Escape must close the menu rather than the article underneath.
  React.useEffect(() => {
    if (!showReaderAppearance) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!readerAppearanceRef.current?.contains(event.target as Node)) setShowReaderAppearance(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setShowReaderAppearance(false);
      readerAppearanceButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [showReaderAppearance]);

  React.useEffect(() => {
    if (selectedArticle) {
      readerReturnFocusRef.current = (document.activeElement as HTMLElement) || null;
      // Wait a frame: the reader paints in this commit, and focusing before it lands makes iOS
      // scroll the page instead of the reader.
      requestAnimationFrame(() => readerCloseButtonRef.current?.focus());
    } else if (readerReturnFocusRef.current) {
      readerReturnFocusRef.current.focus?.();
      readerReturnFocusRef.current = null;
    }
  }, [selectedArticle]);

  useEffect(() => {
    if (savedIds.length > 0) {
      const allKnownArticles = [...digest, ...feedStreamArticles];
      if (allKnownArticles.length > 0) {
        setSavedArticles(prev => {
          const existingIds = new Set(prev.map(a => a.id));
          const missing = allKnownArticles.filter(item => savedIds.includes(item.id) && !existingIds.has(item.id));
          if (missing.length > 0) {
            return [...prev, ...missing];
          }
          return prev;
        });
      }
    }
  }, [digest, feedStreamArticles, savedIds]);

  const unreadSourceCount = sources.filter(source => !readSourceIds.includes(source.id)).length;
  const sourcesByFolder = sources.reduce((acc, src) => {
    const folder = displayFolder(src.folder);
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(src);
    return acc;
  }, {} as Record<string, SourceItem[]>);
  const sourceFolders = Array.from(new Set(['General', ...sources.map(src => displayFolder(src.folder))])).sort((a, b) => a.localeCompare(b));
  const sourceCategories = Array.from(new Set([
    'General',
    ...sourceFolders,
    ...sources.flatMap(src => normalizeCategoryLabels(src.categories, src.folder)),
  ])).sort((a, b) => a.localeCompare(b));
  const filteredSourcesByFolder = Object.entries(sourcesByFolder).reduce((acc, [folder, folderSources]) => {
    const matching = folderSources
      .filter(src => `${src.title} ${src.feedUrl} ${folder} ${normalizeCategoryLabels(src.categories, src.folder).join(' ')}`.toLowerCase().includes(sourceSearch.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title));
    if (matching.length > 0) acc[folder] = matching;
    return acc;
  }, {} as Record<string, SourceItem[]>);

  // The source an open article came from, plus its cached description (the article's own
  // copy of the blurb wins when the feed supplied one).
  const readerSource = selectedArticle
    ? sources.find(src => src.title.trim().toLowerCase() === selectedArticle.source.trim().toLowerCase())
    : undefined;
  const readerSourceDescription = (selectedArticle?.sourceDescription || readerSource?.description || '').trim();

  // Editable feed categories, rather than organizational folders, seed interest suggestions.
  const interestSuggestions = suggestionsFromFolders(sources.flatMap(src =>
    normalizeCategoryLabels(src.categories, src.folder)
  ));

  // Pieces saved before the cleaner kept links, which the Saved header can upgrade in one pass.
  const staleSavedCount = savedArticles.filter(articleNeedsLinkRefresh).length;
  const linkRefreshPercent = linkRefreshProgress && linkRefreshProgress.total > 0
    ? Math.round((linkRefreshProgress.done / linkRefreshProgress.total) * 100)
    : 0;

  const savedDigestItems = [
    ...savedArticles,
    ...digest.filter(d => savedIds.includes(d.id) && !savedArticles.some(s => s.id === d.id)),
    ...feedStreamArticles.filter(a => savedIds.includes(a.id) && !savedArticles.some(s => s.id === a.id))
  ];
  const normalDigest = digest.filter(d => !d.isOutOfBubble);
  const outOfBubbleDigest = digest.filter(d => d.isOutOfBubble);
  const mutedDigestItems = digest.filter(item => Boolean(mutedCards[item.id]));
  // What the reader can actually read in this edition, for the closing card
  // The app only builds when it is opened, and a failed build leaves the cached edition on
  // screen. Once that edition is from an earlier day the heading cannot say "Today's".
  const editionIsToday = digestCuratedAt > 0
    && new Date(digestCuratedAt).toDateString() === new Date().toDateString();
  const editionHeading = digest.length === 0 || editionIsToday ? "Today's Digest" : 'Your last edition';
  // The settings sheet names the same edition the page is showing, so the two never disagree.
  const editionSheetTitle = digest.length === 0 || editionIsToday ? 'Today\u2019s edition' : 'Your last edition';
  const editionItems = digest.filter(item => !mutedCards[item.id]);
  const editionMinutes = editionItems.reduce((total, item) => total + (parseInt(item.readTime, 10) || 0), 0);
  const allDigestItemsMuted = digest.length > 0 && mutedDigestItems.length === digest.length;
  // Say how much is actually readable, so a fully muted digest never claims items are waiting.
  const digestSummaryLabel = digest.length === 0
    ? 'No stories yet'
    : mutedDigestItems.length > 0
      ? `${digest.length} ${digest.length === 1 ? 'story' : 'stories'} · ${mutedDigestItems.length} hidden`
      : `${digest.length} ${digest.length === 1 ? 'story' : 'stories'} worth your time`;

  const restoreAllMutedCards = () => {
    const restoredIds = mutedDigestItems.map(item => item.id);
    if (restoredIds.length === 0) return;

    // Muting starts a background refresh. Cancel it so a response built from the dislike
    // cannot land after the restore and replace the stories the reader just brought back.
    digestRequestRef.current += 1;
    setLoadingDigest(false);

    setMutedCards((current) => {
      const next = { ...current };
      restoredIds.forEach((id) => { delete next[id]; });
      return next;
    });
    setSemanticFeedback((current) => current.filter(entry => !restoredIds.includes(entry.id)));
    setSignals((current) => ({
      ...current,
      lessIds: (current.lessIds || []).filter(id => !restoredIds.includes(id)),
      moreTopics: [],
      lessTopics: [],
      more: [],
      less: [],
    }));

    showToast(restoredIds.length === 1
      ? 'Restored 1 hidden story to your digest'
      : `Restored ${restoredIds.length} hidden stories to your digest`);
  };
  const currentCalibrationItem = calibrationCandidates[calibrationIndex];
  const articleParagraphs = selectedArticle ? buildArticleParagraphs(selectedArticle.fullText) : [];
  const readAloudActive = Boolean(selectedArticle && speechArticleId === selectedArticle.id);
  // The tick on the progress line marks the furthest point this piece has been read to, so
  // scrolling back up does not wipe out where the reader actually got to.
  const readerFurthestDepth = selectedArticle
    ? Math.min(100, readingStats[selectedArticle.id]?.maxDepth || 0)
    : 0;
  const speechPercent = speechProgress.total > 0
    ? Math.min(100, Math.round((speechProgress.index / speechProgress.total) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-slate-800 selection:text-white w-full max-w-full overflow-x-clip">
      {/* Toast status and Undo action, kept clear of the reading header and text */}
      {activeToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed safe-toast left-1/2 -translate-x-1/2 z-[60] w-fit max-w-[calc(100vw-2rem)] bg-slate-900/95 border border-slate-700/80 text-slate-200 text-sm px-4 py-3 rounded-2xl shadow-2xl flex flex-wrap items-center gap-3 animate-fade-in backdrop-blur-md"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="min-w-0 flex-[1_1_12rem] leading-snug">{activeToast.message}</span>
          {activeToast.actionLabel && activeToast.onAction && (
            <button
              type="button"
              onClick={() => {
                activeToast.onAction?.();
                setActiveToast(null);
              }}
              className="ml-auto shrink-0 inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{activeToast.actionLabel}</span>
            </button>
          )}
        </div>
      )}

      {/* Reading View Modal */}
      {selectedArticle && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selectedArticle.title}
          data-reader-theme={readerTheme}
          className="reader-surface fixed inset-0 z-50 overflow-y-auto flex flex-col animate-fade-in"
          onScroll={(e) => {
            const target = e.currentTarget;
            const scrollHeight = target.scrollHeight - target.clientHeight;
            if (scrollHeight > 0 && selectedArticle) {
              const progress = Math.min(100, Math.round((target.scrollTop / scrollHeight) * 100));
              // The bar follows where the reader is now; the stats below keep the furthest point
              // they reached, which is what decides whether a piece counts as read.
              setReaderScrollProgress(prev => (prev === progress ? prev : progress));
              const previousDepth = readingStats[selectedArticle.id]?.maxDepth || 0;
              const wasFinished = previousDepth >= READ_THROUGH_DEPTH;
              setReadingStats(prev => {
                const current = prev[selectedArticle.id] || { maxDepth: 0, finished: false };
                const newMax = Math.max(current.maxDepth || 0, progress);
                const finished = newMax >= READ_THROUGH_DEPTH;
                if (newMax === (current.maxDepth || 0) && finished === Boolean(current.finished)) return prev;
                return {
                  ...prev,
                  [selectedArticle.id]: { maxDepth: newMax, finished, lastRead: Date.now() }
                };
              });
              if (progress >= READ_THROUGH_DEPTH || wasFinished) {
                setReadArticleIds(prev => (prev.includes(selectedArticle.id) ? prev : [...prev, selectedArticle.id]));
                const minutes = parseInt(selectedArticle.readTime) || 0;
                setWeeklyHistory(prev => {
                  if (prev.some(it => it.id === selectedArticle.id)) return prev;
                  return [{
                    id: selectedArticle.id,
                    title: selectedArticle.title,
                    source: selectedArticle.source,
                    folder: selectedArticle.folder,
                    readTime: selectedArticle.readTime,
                    minutesSpent: minutes,
                    completedAt: Date.now(),
                    url: selectedArticle.url
                  }, ...prev];
                });
              }
            }
          }}
        >
          <header className="reader-header sticky top-0 z-30 safe-reader-header backdrop-blur-md border-b px-4 sm:px-6 pb-4 flex items-center justify-between gap-2">
            {/* How far through the piece the reader has scrolled. The line starts just below the
                phone's safe area, because the header's top padding is where the notch sits and a
                line drawn at the very top disappears underneath it. */}
            <div className="reader-header-progress absolute inset-x-0 top-[env(safe-area-inset-top,0px)] h-1 overflow-hidden">
              <div
                className="reader-fill h-full transition-[width] duration-150 ease-out"
                style={{ width: `${readerScrollProgress}%` }}
                role="progressbar"
                aria-valuenow={readerScrollProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Article reading progress"
              />
              {readerFurthestDepth > readerScrollProgress && (
                <div
                  className="reader-furthest absolute inset-y-0 w-[2px]"
                  style={{ right: `${100 - readerFurthestDepth}%` }}
                  aria-hidden="true"
                />
              )}
            </div>

            <button
              type="button"
              ref={readerCloseButtonRef}
              onClick={closeArticle}
              className="reader-dim-button flex items-center gap-2 min-h-10 px-1 text-sm font-medium whitespace-nowrap transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{readerBackLabel}</span>
            </button>
            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={() => handleToggleReadAloud(selectedArticle)}
                aria-pressed={readAloudActive}
                className={`reader-button px-3 py-2 min-h-11 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition ${readAloudActive ? 'is-on' : ''}`}
                title={readAloudActive
                  ? (speechPaused ? 'Resume reading aloud' : 'Pause reading aloud')
                  : `Read aloud with ${speechVoiceLabel}`}
                aria-label={readAloudActive
                  ? (speechPaused ? 'Resume reading aloud' : 'Pause reading aloud')
                  : 'Read aloud'}
              >
                {speechPlaying ? (
                  speechPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Volume2 className="reader-accent w-3.5 h-3.5" />
                )}
                {/* Below 380px the label would wrap the whole bar onto two lines, so the
                    button keeps its icon and its aria-label instead. */}
                <span className="whitespace-nowrap max-[380px]:hidden">{speechPlaying ? (speechPaused ? 'Resume' : 'Pause') : 'Read aloud'}</span>
              </button>
              <button 
                onClick={() => handleSave(selectedArticle)}
                aria-pressed={savedIds.includes(selectedArticle.id)}
                className="reader-button p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition-colors"
                title={savedIds.includes(selectedArticle.id) ? 'Remove from saved' : 'Save for later'}
                aria-label={savedIds.includes(selectedArticle.id) ? `Remove "${selectedArticle.title}" from saved` : `Save "${selectedArticle.title}" for later`}
              >
                <Bookmark className="w-4 h-4" />
              </button>

              {/* Reading appearance: theme, face and size, one tap from the article */}
              <div className="relative" ref={readerAppearanceRef}>
                <button
                  type="button"
                  ref={readerAppearanceButtonRef}
                  onClick={() => setShowReaderAppearance(open => !open)}
                  aria-expanded={showReaderAppearance}
                  aria-controls="reader-appearance-menu"
                  className={`reader-button p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition-colors ${showReaderAppearance ? 'is-on' : ''}`}
                  title="Reading appearance — theme, typeface, text size"
                  aria-label="Reading appearance"
                >
                  <span aria-hidden="true" className="reader-serif text-[0.95rem] font-medium leading-none">Aa</span>
                </button>

                {showReaderAppearance && (
                  <div
                    id="reader-appearance-menu"
                    role="group"
                    aria-label="Reading appearance"
                    className="reader-panel absolute right-0 top-full z-40 mt-2 w-[min(17.5rem,calc(100vw-3rem))] rounded-2xl border p-3 shadow-2xl animate-fade-in"
                  >
                    <p className="reader-dim text-[0.6875rem] font-semibold uppercase tracking-[0.14em] mb-2">Theme</p>
                    <div className="grid grid-cols-3 gap-2">
                      {READER_THEMES.map(theme => (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => setReaderTheme(theme.id)}
                          aria-pressed={readerTheme === theme.id}
                          className="reader-button flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-[0.6875rem] font-medium transition"
                        >
                          <span
                            aria-hidden="true"
                            className="h-6 w-6 rounded-full border"
                            style={{ backgroundColor: theme.swatch, borderColor: `${theme.ink}33` }}
                          />
                          <span>{theme.label}</span>
                        </button>
                      ))}
                    </div>

                    <p className="reader-dim text-[0.6875rem] font-semibold uppercase tracking-[0.14em] mt-3 mb-2">Typeface</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setReaderFace('serif')}
                        aria-pressed={readerFace === 'serif'}
                        className="reader-serif reader-button rounded-xl border px-2 py-2.5 text-sm transition"
                      >
                        Serif
                      </button>
                      <button
                        type="button"
                        onClick={() => setReaderFace('sans')}
                        aria-pressed={readerFace === 'sans'}
                        className="reader-sans reader-button rounded-xl border px-2 py-2.5 text-sm transition"
                      >
                        Sans-serif
                      </button>
                    </div>

                    <p className="reader-dim text-[0.6875rem] font-semibold uppercase tracking-[0.14em] mt-3 mb-2">Text size</p>
                    <div className="grid grid-cols-4 gap-2">
                      {READER_SIZES.map(size => (
                        <button
                          key={size}
                          type="button"
                          onClick={() => setReaderSize(size)}
                          aria-pressed={readerSize === size}
                          className="reader-button rounded-xl border px-1 py-2 text-xs font-semibold tabular-nums transition"
                          aria-label={`Text size ${size} pixels`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>

          <main
            className={`reader-column mx-auto w-full px-6 py-10 flex-1 ${readerFace === 'serif' ? 'reader-serif' : 'reader-sans'}`}
            style={{ fontSize: `${readerSize}px` }}
          >
            <div className="reader-dim font-sans text-xs mb-3 flex items-center gap-2 flex-wrap">
              {readerSourceDescription ? (
                <button
                  type="button"
                  onClick={() => setShowReaderSourceNote(prev => !prev)}
                  className="reader-strong inline-flex items-center gap-1 font-medium transition cursor-pointer"
                  aria-expanded={showReaderSourceNote}
                  title={showReaderSourceNote ? 'Hide the source description' : `About ${selectedArticle.source}`}
                >
                  <span>{selectedArticle.source}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showReaderSourceNote ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <span className="reader-ink font-medium">{selectedArticle.source}</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{selectedArticle.folder}</span>
              <span aria-hidden="true">·</span>
              <span>{decodeArticleEntities(selectedArticle.readTime || '')}</span>
              {selectedArticle.publishedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{decodeArticleEntities(selectedArticle.publishedAt)}</span>
                </>
              )}
            </div>

            {showReaderSourceNote && readerSourceDescription && (
              <p className="reader-dim reader-border font-sans text-xs leading-relaxed mb-4 border-l pl-3">
                {readerSourceDescription}
              </p>
            )}

            <h1 className="reader-ink font-sans text-2xl md:text-3xl font-semibold tracking-tight mb-6 leading-snug">
              {selectedArticle.title}
            </h1>

            {/* Clear editorial context note */}
            <div className="reader-dim reader-border font-sans mb-8 pb-5 border-b text-xs">
              <div className="reader-accent font-medium mb-1">Curator's Note</div>
              <p className="reader-ink opacity-90 italic leading-relaxed">{selectedArticle.why}</p>
            </div>

            {/* Read Aloud: what is being spoken, and how far through it is */}
            {readAloudActive && (
              <div className="reader-panel font-sans mb-8 p-3 rounded-xl border animate-fade-in shadow-md">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => handleToggleReadAloud(selectedArticle)}
                      className="reader-play h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition"
                      title={speechPaused ? 'Resume' : 'Pause'}
                    >
                      {speechPaused ? <Play className="w-3.5 h-3.5 fill-current ml-0.5" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                    </button>
                    <span
                      className="reader-ink truncate"
                      title={`${speechVoiceLabel} at ${speechRate.toFixed(2)}×`}
                    >
                      {speechPaused ? 'Audio paused' : `Reading aloud · ${speechVoiceLabel}`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="reader-dim text-xs tabular-nums">{speechPercent}%</span>
                    <button
                      type="button"
                      onClick={handleStopReadAloud}
                      className="reader-stop w-8 h-8 -mr-1 flex items-center justify-center rounded-lg transition"
                      title="Stop reading aloud"
                      aria-label="Stop reading aloud"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </div>
                </div>

                <div
                  className="reader-track mt-2 h-1 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={speechPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Read aloud progress"
                >
                  <div
                    className="reader-fill h-full transition-all duration-300"
                    style={{ width: `${speechPercent}%` }}
                  />
                </div>

                <p className="reader-dim mt-2 text-xs">
                  {speechProgress.paragraph >= 0 && articleParagraphs.length > 0
                    ? `Paragraph ${Math.min(speechProgress.paragraph + 1, articleParagraphs.length)} of ${articleParagraphs.length} · `
                    : ''}
                  sentence {Math.min(speechProgress.index + 1, speechProgress.total || 1)} of {speechProgress.total || 1}
                  {' · '}tap a paragraph to listen from there
                </p>
              </div>
            )}

            <div className="reader-body">
              {articleParagraphs.length > 0 ? articleParagraphs.map((paragraph, idx) => {
                const isSpeakingHere = readAloudActive && speechProgress.paragraph === idx;
                return (
                  <p
                    key={idx}
                    id={`reader-paragraph-${idx}`}
                    onClick={readAloudActive ? () => jumpSpeechToParagraph(idx) : undefined}
                    title={readAloudActive ? 'Listen from this paragraph' : undefined}
                    className={`text-pretty ${
                      isSpeakingHere
                        ? 'reader-speaking reader-ink border-l-2 pl-4 -ml-4'
                        : readAloudActive
                          ? 'cursor-pointer'
                          : ''
                    }`}
                  >{renderParagraphText(paragraph)}</p>
                );
              }) : (
                <p className="reader-dim text-base">This feed supplied no readable body text. Use “Read original” below to open the article.</p>
              )}
            </div>

            {/* Typographic End-mark, then a hairline that closes the article without a gap
                the reader has to travel across to reach the buttons */}
            <div className="reader-dim flex items-center justify-center pt-6 pb-4">
              <span className="text-sm tracking-[0.6em] select-none opacity-40 font-serif">· · ·</span>
            </div>

            {/* Minimalist Editorial Completion & Tuning Footer */}
            <footer className="reader-border font-sans border-t pt-5 pb-24">
              {/* Primary Outbound Action & Feedback Row */}
              <div className="flex items-center justify-between gap-4">
                <a
                  href={selectedArticle.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    // Only a record of when it was opened: reading the rest happens in another
                    // app, which this one cannot see, so it must not claim the article was finished.
                    setReadingStats(prev => ({
                      ...prev,
                      [selectedArticle.id]: {
                        ...prev[selectedArticle.id],
                        lastRead: Date.now()
                      }
                    }));
                    setReadArticleIds(prev => (prev.includes(selectedArticle.id) ? prev : [...prev, selectedArticle.id]));
                    showToast(`Opening original on ${selectedArticle.source}`);
                  }}
                  className="reader-link inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer"
                  title={`Read original on ${selectedArticle.source} (opens external browser or app)`}
                  aria-label={`Read original on ${selectedArticle.source}`}
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Read original</span>
                </a>

                {/* Feedback Icons Aligned to Right */}
                <div className="flex flex-wrap items-center gap-2 ml-auto">
                  <FeedbackActions
                    tone="reader"
                    isMore={signals.moreIds?.includes(selectedArticle.id) || false}
                    isLess={signals.lessIds?.includes(selectedArticle.id) || false}
                    onMore={() => handleMore(selectedArticle)}
                    onLess={() => handleLess(selectedArticle)}
                  />
                  {signals.lessIds?.includes(selectedArticle.id) && (
                    <button
                      type="button"
                      onClick={() => undoHandleLess(selectedArticle.id)}
                      className="reader-link inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors"
                      title="Undo — put this one story back in your digest"
                      aria-label="Undo — put this one story back in your digest"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Undo</span>
                    </button>
                  )}
                </div>
              </div>
            </footer>
          </main>
        </div>
      )}

      {/* Main Top Header Bar */}
      <header inert={backgroundInert} className="sticky top-0 z-40 w-full safe-header bg-slate-950/95 backdrop-blur-md border-b border-slate-900/80 px-4 sm:px-6 pb-3 shrink-0 shadow-sm">
        <div className="max-w-3xl w-full mx-auto flex items-center justify-between gap-2 sm:gap-3">
          {/* Official Brand Logo & Subtitle */}
          <button 
            type="button" 
            onClick={() => setActiveTab('today')}
            className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 group cursor-pointer"
            title="The Curator — Home"
          >
            <CuratorMark className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 drop-shadow-md group-hover:scale-105 transition-transform" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5 leading-none whitespace-nowrap">
                <span className="font-serif text-xs font-semibold tracking-[0.24em] text-amber-500/90">THE</span>
                <span className="font-serif text-base font-bold tracking-[0.16em] text-slate-100">CURATOR</span>
              </div>
              <p className="text-xs text-slate-400 mt-1 truncate hidden sm:block">Your morning reading editor</p>
            </div>
          </button>

          {/* One refresh in the whole app, and only where it means something: on Today it
              rebuilds the digest. Feeds and Sources refresh their own feeds instead. */}
          <div className="hidden sm:block flex-1" aria-hidden="true" />
          {activeTab === 'today' && (
            <button
              type="button"
              onClick={() => generateDigest({ fresh: true })}
              disabled={loadingDigest}
              className="w-11 h-11 shrink-0 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-slate-100 hover:border-slate-700 transition disabled:opacity-50 cursor-pointer"
              title="Refresh today's digest"
              aria-label="Refresh today's digest"
            >
              <RefreshCw className={`w-4 h-4 ${loadingDigest ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setActiveTab(prev => prev === 'settings' ? 'today' : 'settings')}
            className={`w-11 h-11 shrink-0 rounded-full border flex items-center justify-center transition cursor-pointer shadow-sm ${
                activeTab === 'settings'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-slate-100 hover:border-slate-700'
              }`}
              title="Settings & Preferences"
              aria-label="Settings & Preferences"
              aria-pressed={activeTab === 'settings'}
            >
            <Sliders className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Content Area */}
      <main inert={backgroundInert} className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-32 safe-main overflow-x-clip">
        {/* A write the browser refused: say so plainly, and offer a copy while it is still here */}
        {storageFailure && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-200"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <p className="min-w-0 flex-1 leading-relaxed">
              {storageFailure === 'quota'
                ? 'This browser is out of space for Curator, so new saves may not survive a reload.'
                : 'This browser is blocking local storage, so nothing new can be kept after a reload.'}
              {' '}Export a copy to keep your library.
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadAppData()}
                className="inline-flex min-h-11 items-center rounded-lg border border-amber-500/40 px-3 font-semibold text-amber-200 transition hover:bg-amber-500/20"
              >
                Export
              </button>
              <button
                type="button"
                onClick={() => setStorageFailure(null)}
                aria-label="Dismiss the storage warning"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-amber-300/80 transition hover:text-amber-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: TODAY */}
        {activeTab === 'today' && (
          <div className="space-y-6 animate-fade-in w-full max-w-full">
            <div className="flex flex-col items-start gap-3 border-b border-slate-900 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">{editionHeading}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loadingDigest && digest.length === 0
                    ? "Synthesizing today's list…"
                    : `${digestCuratedAt > 0
                        ? `Built ${formatCuratedAt(digestCuratedAt)}${editionIsToday ? '' : ' — not today’s'}`
                        : digest.length > 0
                          ? 'Edition date not recorded'
                          : `Today's digest · ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`
                      } · ${digestSummaryLabel}${
                        semanticSummary && semanticSummary.feedbackExamples > 0
                          ? ` · ranked from ${semanticSummary.feedbackExamples} vote example${semanticSummary.feedbackExamples === 1 ? '' : 's'}`
                          : ''
                      }`}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 text-xs text-slate-400 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setShowDigestSettings(true)}
                  aria-haspopup="dialog"
                  aria-expanded={showDigestSettings}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/60 px-3 font-medium text-slate-300 transition hover:border-amber-500/40 hover:text-amber-300"
                >
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>{itemCount} stories</span>
                  {compactCards && <span className="text-slate-400">· compact</span>}
                </button>
              </div>
            </div>

            {feedReport && feedReport.failed.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('sources')}
                className="w-full flex items-center gap-2 text-left text-xs text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 hover:bg-amber-500/10 transition"
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {feedReport.failedCount ?? feedReport.failed.length} of {feedReport.attempted} feeds returned nothing today
                  {' '}({feedReport.failed.slice(0, 3).map(f => f.title).join(', ')}
                  {feedReport.failed.length > 3 ? ', …' : ''}). Tap to review sources.
                </span>
              </button>
            )}

            {digestOffline && digest.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  Can’t reach the server, so this is your last edition{digestCuratedAt > 0 ? ` from ${formatCuratedAt(digestCuratedAt)}` : ''} — not today’s.
                </span>
                <button
                  type="button"
                  onClick={() => generateDigest({ fresh: true })}
                  className="min-h-9 rounded-lg border border-amber-500/40 px-2.5 font-medium transition hover:bg-amber-500/15"
                >
                  Retry
                </button>
              </div>
            )}

            {/* One feed is a real digest, but a thin one. Say so instead of waiting for the
                reader to notice the carousel has a single circle. */}
            {sources.length === 1 && (
              <div className="rounded-3xl border border-amber-500/25 bg-amber-500/5 p-5">
                <div className="flex items-start gap-3">
                  <Rss className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100">One feed makes a thin edition</h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      You are following <span className="text-slate-200">{sources[0]?.title || 'a single feed'}</span>.
                      Add a few more, or import the feeds you already follow, and the next edition you build is wider.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('sources')}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-amber-500 px-4 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add sources</span>
                      </button>
                      <button
                        type="button"
                        onClick={openImportModal}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-700 px-4 text-xs font-medium text-slate-200 transition hover:border-amber-500/40 hover:text-amber-300"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Import OPML</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {loadingDigest && digest.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Synthesizing your morning reading list...</p>
                {digestSlow && (
                  <div className="mx-auto max-w-xs space-y-2 pt-2">
                    <p className="text-xs leading-relaxed text-slate-400">
                      Still working — the server may be waking up from idle. A cold start can take
                      up to a minute.
                    </p>
                    <button
                      type="button"
                      onClick={() => generateDigest({ fresh: true })}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-xs font-semibold text-slate-200 transition hover:border-amber-500/40 hover:text-amber-300"
                    >
                      <span>Start over</span>
                    </button>
                  </div>
                )}
              </div>
            ) : digestError && digest.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <AlertCircle className="w-6 h-6 mx-auto text-amber-400" />
                <p className="text-sm font-medium text-slate-200">Couldn’t build today’s edition</p>
                <p className="mx-auto max-w-sm text-xs leading-relaxed text-slate-400">{digestError}</p>
                <button
                  type="button"
                  onClick={() => generateDigest({ fresh: true })}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
                >
                  <span>Try again</span>
                </button>
              </div>
            ) : allDigestItemsMuted ? (
              <DigestEmptyState
                mode="muted"
                mutedCount={mutedDigestItems.length}
                onRestoreMuted={restoreAllMutedCards}
                onManageSources={() => setActiveTab('sources')}
              />
            ) : digest.length === 0 ? (
              <DigestEmptyState
                mode="quiet"
                mutedCount={0}
                onRestoreMuted={restoreAllMutedCards}
                onManageSources={() => setActiveTab('sources')}
              />
            ) : (
              <div className="space-y-8">
                {/* Normal Curated Cards */}
                {normalDigest.map((item) => {
                  const actions = getCardActions(item.id);

                  if (mutedCards[item.id]) {
                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs animate-fade-in backdrop-blur-sm shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1 text-slate-300">
                          <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="min-w-0">
                            Less like this · <span className="font-semibold text-slate-200">"{item.title}"</span> hidden
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); undoHandleLess(item.id); }}
                            className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                            title="Undo — put this one story back in your digest"
                            aria-label="Undo — put this one story back in your digest"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Undo</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); permanentlyDismissMuted(item.id); }}
                            className="text-slate-400 hover:text-slate-100 p-1.5 rounded-md transition"
                            title="Dismiss placeholder and remove this story from today"
                            aria-label="Dismiss placeholder and remove this story from today"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <article 
                      key={item.id}
                      onClick={() => openArticle(item)}
                      // A card is a reading surface, not a button: a short name, and the four actions
                      // inside it stay separately announced instead of being flattened into one label.
                      aria-label={`${item.title} — ${item.source}`}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openArticle(item);
                        }
                      }}
                      className={`group ${compactCards ? 'rounded-2xl' : 'rounded-3xl'} transition-all duration-300 cursor-pointer overflow-hidden relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.12)] hover:border-amber-500/60 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(245,158,11,0.35)]'
                      }`}
                    >
                      {/* Author sub-header with Substack branding and Actioned status */}
                      <div className={`${compactCards ? 'p-4 pb-2' : 'p-5 pb-3'} flex items-center justify-between`}>
                        <div className="flex items-center gap-3 min-w-0">
                          {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source} loading="lazy"
                                    className="w-full h-full object-cover rounded-full"
                                    onLoad={markTinyIcon}
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.card-author-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`card-author-initials text-xs font-bold text-amber-400 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span className="truncate">{item.source}</span>
                            </div>
                            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                              <span className="min-w-0">{decodeArticleEntities(item.publishedAt || '30m')}</span>
                              <span aria-hidden="true">·</span>
                              <span className="min-w-0">{displayFolder(item.folder)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="shrink-0 font-medium text-slate-300">{decodeArticleEntities(item.readTime || '')}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {actions.isReadThrough ? (
                            <div 
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-xs font-bold text-emerald-300 shadow-sm"
                              title="Read through completed"
                            >
                              <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                              <span>Read</span>
                            </div>
                          ) : actions.isVotedMore ? (
                            <div className="flex items-center px-2 py-1 rounded-full bg-amber-950/90 border border-amber-500/50" title="More like this">
                              <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                          ) : actions.isVotedLess ? (
                            <div className="flex items-center px-2 py-1 rounded-full bg-rose-950/90 border border-rose-500/50" title="Less like this">
                              <ThumbsDown className="w-3.5 h-3.5 text-rose-400" />
                            </div>
                          ) : actions.isClicked ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-xs font-medium text-sky-300">
                              <span>Opened</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              <span>New</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Intentional placeholder keeps the card's rhythm when a story has no hero image */}
                      {!item.bannerImage && (
                        <div className={`mx-3.5 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center ${compactCards ? 'h-24' : 'h-32'}`}>
                          <div className="text-center px-4">
                            <CuratorMark className="w-7 h-7 mx-auto mb-1.5 opacity-80" />
                            <div className="text-xs uppercase font-bold tracking-wider text-amber-400/90">{displayFolder(item.folder)}</div>
                          </div>
                        </div>
                      )}
                      {/* Billboard Hero Image Card with Bookmark Save Button right on image */}
                      {item.bannerImage && (
                        <div className={`relative mx-3.5 rounded-2xl overflow-hidden ${compactCards ? 'h-40 md:h-48' : 'h-60 md:h-72'} shadow-lg border border-slate-700/60`}>
                          <img 
                            src={item.bannerImage} 
                            alt={item.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                          
                        </div>
                      )}

                      <div className={`${compactCards ? 'p-4 space-y-3 pt-3' : 'p-5 space-y-4 pt-4'}`}>
                        <div>
                          {item.bannerImage && (
                            <div className="text-xs uppercase font-bold tracking-wider text-amber-400/90 mb-1">
                              {displayFolder(item.folder)}
                            </div>
                          )}
                          <h3 className={`${compactCards ? 'text-lg' : 'text-xl'} font-bold tracking-tight text-slate-100 group-hover:text-amber-300 transition-colors`}>
                            {item.title}
                          </h3>
                          <p className={`${compactCards ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2'} text-slate-400 mt-1`}>
                            {item.summary}
                          </p>
                        </div>

                        {/* Quiet editorial why note */}
                        <p className="text-xs text-slate-400 italic">
                          <span className="text-amber-400/90 font-medium not-italic">Why: </span>{item.why}
                        </p>

                        {/* Card Curation & Reading Actions */}
                        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-amber-300 hover:text-amber-200 transition"
                            >
                              Read in Curator <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={item.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                                showToast(`Opening source on ${item.source}`);
                              }}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-amber-300 transition-colors"
                              title={`Read original on ${item.source} (opens external browser or app)`}
                              aria-label={`Read original on ${item.source}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition ${
                                savedIds.includes(item.id)
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                                  : 'border-transparent text-slate-400 hover:text-amber-300'
                              }`}
                              title={savedIds.includes(item.id) ? 'Remove from saved' : 'Save for later'}
                              aria-label={savedIds.includes(item.id) ? `Remove "${item.title}" from saved` : `Save "${item.title}" for later`}
                              aria-pressed={savedIds.includes(item.id)}
                            >
                              <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                            </button>
                          </div>
                          <FeedbackActions
                            isMore={actions.isVotedMore}
                            isLess={actions.isVotedLess}
                            onMore={() => handleMore(item)}
                            onLess={() => handleLess(item)}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}

                {/* Out of Bubble Stretch Section */}
                {outOfBubbleDigest.length > 0 && (
                  <div className="pt-6 space-y-6">
                    <div className="flex items-center gap-2 border-b border-slate-900 pb-3">
                      <Sparkles className="w-4 h-4 text-rose-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-400">
                        Deliberate stretch
                      </h3>
                    </div>

                    {outOfBubbleDigest.map((item) => {
                      const actions = getCardActions(item.id);

                      if (mutedCards[item.id]) {
                        return (
                          <div
                            key={item.id}
                            className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 text-xs animate-fade-in backdrop-blur-sm shadow-sm"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1 text-slate-300">
                              <EyeOff className="w-4 h-4 text-slate-400 shrink-0" />
                              <span className="min-w-0">
                                Less like this · <span className="font-semibold text-slate-200">"{item.title}"</span> hidden
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); undoHandleLess(item.id); }}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                                title="Undo — put this one story back in your digest"
                                aria-label="Undo — put this one story back in your digest"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Undo</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); permanentlyDismissMuted(item.id); }}
                                className="text-slate-400 hover:text-slate-100 p-1.5 rounded-md transition"
                                title="Dismiss placeholder and remove this story from today"
                                aria-label="Dismiss placeholder and remove this story from today"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <article 
                          key={item.id}
                          onClick={() => openArticle(item)}
                          // A card is a reading surface, not a button: a short name, and the four actions
                          // inside it stay separately announced instead of being flattened into one label.
                          aria-label={`${item.title} — ${item.source}`}
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openArticle(item);
                            }
                          }}
                          className={`group ${compactCards ? 'rounded-2xl' : 'rounded-3xl'} transition-all duration-300 cursor-pointer overflow-hidden relative ${
                            actions.hasAnyAction
                              ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                              : 'bg-slate-900/95 border-2 border-rose-600/70 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(244,63,94,0.3)] hover:border-rose-500 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(244,63,94,0.45)]'
                          }`}
                        >
                          <div className={`${compactCards ? 'p-4 pb-2' : 'p-5 pb-3'} flex flex-wrap items-center justify-between gap-x-3 gap-y-2`}>
                            <div className="flex items-center gap-3 min-w-0 max-w-full">
                            {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-rose-800 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source} loading="lazy"
                                    className="w-full h-full object-cover rounded-full"
                                    onLoad={markTinyIcon}
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.out-author-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`out-author-initials text-xs font-bold text-rose-300 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-rose-200 truncate">{item.source}</div>
                                <div className="text-xs text-rose-400/80 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                                  {item.publishedAt && (
                                    <>
                                      <span className="min-w-0">{decodeArticleEntities(item.publishedAt)}</span>
                                      <span aria-hidden="true">·</span>
                                    </>
                                  )}
                                  <span className="min-w-0">{displayFolder(item.folder)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="shrink-0 font-medium text-rose-300">{decodeArticleEntities(item.readTime || '')}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 min-w-0 flex-wrap justify-end">
                              {actions.isReadThrough ? (
                                <div 
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-xs font-bold text-emerald-300 shadow-sm"
                                  title="Read through completed"
                                >
                                  <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                                  <span>Read</span>
                                </div>
                              ) : actions.isVotedMore ? (
                                <div className="flex items-center px-2 py-1 rounded-full bg-amber-950/90 border border-amber-500/50" title="More like this">
                                  <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
                                </div>
                              ) : actions.isVotedLess ? (
                                <div className="flex items-center px-2 py-1 rounded-full bg-rose-950/90 border border-rose-500/50" title="Less like this">
                                  <ThumbsDown className="w-3.5 h-3.5 text-rose-400" />
                                </div>
                              ) : actions.isClicked ? (
                                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-xs font-medium text-sky-300">
                                  <span>Opened</span>
                                </div>
                              ) : null}
                              <span className="text-xs uppercase font-semibold tracking-wider bg-rose-950/80 text-rose-300 px-2.5 py-0.5 rounded-full border border-rose-800/60">
                                Outside your bubble
                              </span>
                            </div>
                          </div>

                          {!item.bannerImage && (
                            <div className={`mx-3.5 rounded-2xl border border-rose-900/60 bg-gradient-to-br from-rose-950/40 via-slate-950 to-slate-900 flex items-center justify-center ${compactCards ? 'h-24' : 'h-32'}`}>
                              <div className="text-center px-4">
                                <CuratorMark className="w-7 h-7 mx-auto opacity-80" />
                              </div>
                            </div>
                          )}
                          {item.bannerImage && (
                            <div className={`relative mx-3.5 rounded-2xl overflow-hidden ${compactCards ? 'h-40 md:h-48' : 'h-60 md:h-64'} shadow-lg border border-rose-800/40`}>
                              <img 
                                src={item.bannerImage} 
                                alt={item.title} 
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                              
                            </div>
                          )}

                          <div className={`${compactCards ? 'p-4 space-y-3 pt-3' : 'p-5 space-y-4 pt-4'}`}>
                            <div>
                              <h3 className={`${compactCards ? 'text-lg' : 'text-xl'} font-bold tracking-tight text-slate-100 group-hover:text-rose-300 transition-colors`}>
                                {item.title}
                              </h3>
                              <p className={`${compactCards ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2'} text-slate-400 mt-1`}>
                                {item.summary}
                              </p>
                            </div>

                            {/* Quiet editorial why note */}
                            <p className="text-xs text-rose-300/80 italic">
                              <span className="text-rose-400 font-medium not-italic">Why: </span>{item.why}
                            </p>

                            {/* Stretch Card Actions: Read more, More, Less */}
                            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                                  className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-rose-300 hover:text-rose-200 transition"
                                >
                                  Read in Curator <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                                <a
                                  href={item.url || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                                    showToast(`Opening source on ${item.source}`);
                                  }}
                                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-rose-400 hover:text-rose-300 transition-colors"
                                  title={`Read original on ${item.source} (opens external browser or app)`}
                                  aria-label={`Read original on ${item.source}`}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition ${
                                    savedIds.includes(item.id)
                                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                                      : 'border-transparent text-slate-400 hover:text-amber-300'
                                  }`}
                                  title={savedIds.includes(item.id) ? 'Remove from saved' : 'Save for later'}
                                  aria-label={savedIds.includes(item.id) ? `Remove "${item.title}" from saved` : `Save "${item.title}" for later`}
                                  aria-pressed={savedIds.includes(item.id)}
                                >
                                  <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                                </button>
                              </div>
                              <FeedbackActions
                                isMore={actions.isVotedMore}
                                isLess={actions.isVotedLess}
                                onMore={() => handleMore(item)}
                                onLess={() => handleLess(item)}
                              />
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

                {/* The edition ends here: say what they just read, and how the next one arrives.
                    Nothing is scheduled, so the copy must not imply a 7am delivery. */}
                <div className="rounded-3xl border border-slate-800 bg-slate-900/40 px-5 py-6 text-center">
                  <CuratorMark className="w-8 h-8 mx-auto mb-3 opacity-90" />
                  <p className="text-sm font-semibold text-slate-100">
                    That&apos;s your edition — {editionItems.length} {editionItems.length === 1 ? 'story' : 'stories'}, ~{editionMinutes} minutes.
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Curator has no schedule: a fresh edition builds the next time you open it.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: SAVED */}
        {activeTab === 'saved' && (
          <div className="space-y-6 animate-fade-in">
            <div className="border-b border-slate-900 pb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">Saved Items</h2>
                <p className="text-xs text-slate-400 mt-0.5">Your personal re-reading queue ({savedDigestItems.length})</p>
              </div>
              {/* A piece saved before the cleaner kept links reads without its citations until it
                  is refetched. This does that in one pass, for the pieces you never reopen, and
                  the button becomes the way to stop it while it runs. */}
              {linkRefreshProgress ? (
                <button
                  type="button"
                  onClick={stopSavedQueueLinks}
                  aria-label="Stop adding citations"
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 px-3 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:text-rose-300"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop</span>
                </button>
              ) : staleSavedCount > 0 ? (
                <button
                  type="button"
                  onClick={refreshSavedQueueLinks}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 px-3 text-xs font-medium text-slate-300 transition hover:border-amber-500/40 hover:text-amber-300"
                  title="Read these saved pieces again so the links they cite work in the reader"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Add citations ({staleSavedCount})</span>
                </button>
              ) : null}
            </div>

            {linkRefreshProgress && (
              <div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span aria-live="polite">
                    Adding citations · {linkRefreshProgress.done} of {linkRefreshProgress.total}
                  </span>
                  <span className="tabular-nums text-slate-500">{linkRefreshPercent}%</span>
                </div>
                <div
                  className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800"
                  role="progressbar"
                  aria-label="Adding citations to saved pieces"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={linkRefreshPercent}
                >
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${linkRefreshPercent}%` }}
                  />
                </div>
              </div>
            )}

            {savedDigestItems.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <Bookmark className="w-8 h-8 mx-auto text-slate-700 mb-2" />
                <p className="text-sm">No saved items yet.</p>
                <p className="text-xs text-slate-400">Tap the bookmark icon on any digest item to save it here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {savedDigestItems.map((item) => {
                  const actions = getCardActions(item.id);
                  return (
                    <article 
                      key={item.id}
                      onClick={() => openArticle(item)}
                      // A card is a reading surface, not a button: a short name, and the four actions
                      // inside it stay separately announced instead of being flattened into one label.
                      aria-label={`${item.title} — ${item.source}`}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openArticle(item);
                        }
                      }}
                      className={`p-5 rounded-2xl transition-all duration-300 cursor-pointer space-y-3 relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.3)] hover:border-emerald-400'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_16px_40px_-6px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.1)] hover:border-amber-500/50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span title={item.source} className="font-semibold text-slate-200 min-w-0 truncate">{item.source}</span>
                        {item.publishedAt && <span>{decodeArticleEntities(item.publishedAt)}</span>}
                        <span>{item.readTime}</span>
                        <span className="text-amber-400 font-semibold inline-flex items-center gap-1">
                          <Bookmark className="w-3 h-3 fill-amber-400" /> Saved
                        </span>
                        {actions.isReadThrough && (
                          <span className="text-emerald-400 font-semibold inline-flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[3]" /> Read through
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-semibold text-slate-100 hover:text-amber-300 transition">
                        {item.title}
                      </h3>
                      <p className="text-xs text-slate-400 line-clamp-2">{item.summary}</p>

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                            className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-amber-300 hover:text-amber-200 transition"
                          >
                            Read in Curator <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={item.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                              showToast(`Opening source on ${item.source}`);
                            }}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-amber-300 transition-colors"
                            title={`Read original on ${item.source} (opens external browser or app)`}
                            aria-label={`Read original on ${item.source}`}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                          className="inline-flex min-h-11 items-center rounded-xl px-3 text-xs text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 font-medium transition"
                          aria-label={`Unsave ${item.title}`}
                        >
                          Unsave
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: SOURCES */}
        {/* The setup wizard and the Add Source / OPML overlays are portalled at the top level,
            so opening one of them never mounts this page underneath. */}
        {activeTab === 'sources' && (
          <div className="space-y-8 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-900 pb-4">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-100">Watched Sources</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {sources.length} {sources.length === 1 ? 'source' : 'sources'} across {Object.keys(sourcesByFolder).length} {Object.keys(sourcesByFolder).length === 1 ? 'folder' : 'folders'} · {sources.some(s => s.status === 'failing') ? `${sources.filter(s => s.status === 'failing').length} need attention` : 'all feeds healthy'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowAddSourceModal(true)}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Source</span>
                </button>
                <button
                  onClick={openImportModal}
                  title="Add many sources at once from an OPML export file"
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import OPML</span>
                </button>
              </div>
            </div>

            {/* Failures first: a feed that stopped answering makes everything else on this page
                moot, so it sits above discovery and offers a retry for the whole library. */}
            {failingSourceCount > 0 && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-wrap items-start gap-3 w-full max-w-full">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <span className="font-semibold block mb-0.5">
                    {failingSourceCount === 1 ? 'One source needs attention' : `${failingSourceCount} sources need attention`}
                  </span>
                  <span>
                    {failingSourceCount === 1
                      ? 'It is not responding right now and has been left out of recent digests.'
                      : 'They are not responding right now and have been left out of recent digests.'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRefreshAllFeeds()}
                  disabled={refreshingAllFeeds}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 font-semibold text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
                  title="Re-read every feed, and clear the ones that answer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingAllFeeds ? 'animate-spin' : ''}`} />
                  <span>{refreshingAllFeeds ? 'Refreshing…' : 'Refresh all'}</span>
                </button>
              </div>
            )}

            {/* Google Search & RSS Investigation Tool */}
            <section className="p-4 sm:p-5 rounded-3xl bg-slate-900/40 border border-slate-900 space-y-4 w-full max-w-full overflow-hidden">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Search className="w-4 h-4 text-amber-400" />
                    <span>Discover new sources</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
Search for writers, publications, or topics. Curator checks whether each result has a feed you can follow.
                  </p>
                </div>
                {hasSearchedSources && (
                  <button
                    type="button"
                    onClick={() => {
                      setHasSearchedSources(false);
                      setDiscoverResults([]);
                      setDiscoverGroundingLinks([]);
                      setDiscoverError(null);
                    }}
                    className="inline-flex min-h-11 shrink-0 items-center px-2 -mr-2 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                )}
              </div>

              <form onSubmit={handleDiscoverSources} className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={discoverQuery}
                    onChange={e => setDiscoverQuery(e.target.value)}
                    placeholder="Search writers, publications, or topics"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isDiscovering || !discoverQuery.trim()}
                  className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 transition disabled:opacity-50 whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
                >
                  {isDiscovering ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Investigating...</span>
                    </>
                  ) : (
                    <>
                      <Globe className="w-3.5 h-3.5" />
                      <span>Find sources</span>
                    </>
                  )}
                </button>
              </form>

              {discoverError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{discoverError}</span>
                </div>
              )}

              {hasSearchedSources && !isDiscovering && !discoverError && discoverResults.length === 0 && (
                <p className="text-xs text-slate-400 py-2">
                  No matching publications found for those search terms. Try broader keywords.
                </p>
              )}

              {discoverResults.length > 0 && (
                <div className="space-y-3 pt-1">
                  {discoverResults.map((item, idx) => {
                    const isAdded =
                      !!item.feedUrl &&
                      sources.some(s => s.feedUrl.trim().toLowerCase() === item.feedUrl!.trim().toLowerCase());

                    return (
                      <div
                        key={`${item.siteUrl}-${idx}`}
                        className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-slate-100">{item.title}</span>
                              <span className="text-xs text-slate-400">· {item.folder}</span>
                            </div>
                            <a
                              href={item.siteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-slate-400 hover:text-amber-400 transition inline-flex items-center gap-1 mt-0.5 break-all"
                            >
                              <span>{item.siteUrl}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </div>

                          {item.feedUrl && (item.rssStatus === 'native' || item.rssStatus === 'generatable') ? (
                            <button
                              type="button"
                              disabled={isAdded}
                              onClick={() => handleAddDiscoveredSource(item)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition flex items-center gap-1.5 shrink-0 ${
                                isAdded
                                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                                  : item.rssStatus === 'generatable'
                                    ? 'bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25'
                                    : 'bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400'
                              }`}
                            >
                              {isAdded ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Added</span>
                                </>
                              ) : item.rssStatus === 'generatable' ? (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Generate &amp; Add RSS</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add Feed</span>
                                </>
                              )}
                            </button>
                          ) : (
                            <span className="text-xs text-rose-400 font-medium shrink-0">
                              RSS unavailable
                            </span>
                          )}
                        </div>

                        {item.summary && (
                          <p className="text-xs text-slate-300">{item.summary}</p>
                        )}

                        <div className="text-xs pt-1 border-t border-slate-900 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`font-medium ${
                                item.rssStatus === 'native'
                                  ? 'text-emerald-400'
                                  : item.rssStatus === 'generatable'
                                    ? 'text-amber-400'
                                    : 'text-rose-400'
                              }`}
                            >
                              {item.feedFormat ? item.feedFormat : 'No feed'}
                            </span>
                            <span aria-hidden="true" className="text-slate-400">·</span>
                            <span className="text-slate-400">{item.investigationNote}</span>
                          </div>

                          {item.feedUrl && (
                            <div className="text-xs text-slate-400 font-mono truncate">
                              Feed: {item.feedUrl}
                            </div>
                          )}

                          {item.sampleTitles && item.sampleTitles.length > 0 && (
                            <div className="text-xs text-slate-400 pt-1">
                              Recent items: {item.sampleTitles.join(' · ')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {discoverGroundingLinks.length > 0 && (
                    <div className="pt-2 border-t border-slate-900 text-xs text-slate-400 space-y-1">
                      <span className="block font-medium text-slate-300">Google Search sources</span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {discoverGroundingLinks.map((link, idx) => (
                          <a
                            key={`${link.uri}-${idx}`}
                            href={link.uri}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-amber-400 underline truncate max-w-[240px]"
                          >
                            {link.title || link.uri}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={sourceSearch}
                onChange={e => setSourceSearch(e.target.value)}
                placeholder="Search your sources"
                aria-label="Search sources by name, feed URL, folder, or category"
                className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3 py-3 text-sm text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
              />
            </div>

            <div className="space-y-6 w-full max-w-full">
              {Object.entries(filteredSourcesByFolder).sort(([a], [b]) => a.localeCompare(b)).map(([folder, folderSources]: [string, SourceItem[]]) => (
                <div key={folder} className="space-y-3 w-full max-w-full">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-900 pb-2">
                    {folder} ({folderSources.length})
                  </h3>
                  <div className="grid gap-2 w-full max-w-full">
                    {folderSources.map((src) => {
                      const avatarUrl = getSourceAvatar(src.feedUrl);
                      const isRefreshing = refreshingSourceId === src.id;
                      const descriptionOpen = expandedSourceDescriptionIds.includes(src.id);
                      const categoryLabels = normalizeCategoryLabels(src.categories, src.folder);
                      return (
                        <div key={src.id} className="rounded-xl bg-slate-900/30 border border-slate-900/80 w-full max-w-full overflow-hidden">
                          <div className="p-3 sm:p-3.5 flex items-start justify-between gap-2 sm:gap-3">
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center overflow-hidden shrink-0 relative">
                              {avatarUrl ? (
                                <img 
                                  src={avatarUrl} 
                                  alt={src.title} loading="lazy" 
                                  className="w-full h-full object-cover rounded-full"
                                  onLoad={markTinyIcon}
                                  onError={(e) => {
                                    (e.currentTarget as HTMLElement).style.display = 'none';
                                    const fallback = e.currentTarget.parentElement?.querySelector('.src-list-initials');
                                    if (fallback) fallback.classList.remove('hidden');
                                  }}
                                />
                              ) : null}
                              <span className={`src-list-initials text-xs font-bold text-amber-400 ${avatarUrl ? 'hidden' : ''}`}>
                                {src.title.slice(0, 2).toUpperCase()}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-slate-100 truncate leading-snug">{src.title}</span>
                              <span title={src.feedUrl} className="block text-xs text-slate-500 truncate mt-0.5">{formatFeedUrlForDisplay(src.feedUrl)}</span>
                              {src.description?.trim() ? (
                                <div className="mt-1.5">
                                  <p className={`text-xs text-slate-400 leading-relaxed ${descriptionOpen ? '' : 'line-clamp-2'}`}>
                                    {src.description}
                                  </p>
                                  {src.description.length > 90 && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedSourceDescriptionIds(prev =>
                                        prev.includes(src.id) ? prev.filter(id => id !== src.id) : [...prev, src.id]
                                      )}
                                      className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 hover:text-amber-300 transition cursor-pointer"
                                      aria-expanded={descriptionOpen}
                                      title={descriptionOpen ? 'Show less of this site description' : `Show more about ${src.title}`}
                                    >
                                      <span>{descriptionOpen ? 'Less' : 'More'}</span>
                                      <ChevronDown className={`w-3 h-3 transition-transform ${descriptionOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <p className={`text-xs mt-1.5 ${src.descriptionFetchFailed ? 'text-rose-400' : 'text-slate-600'}`}>
                                  {src.descriptionFetchFailed
                                    ? 'Could not load this site description.'
                                    : src.descriptionCheckedAt
                                      ? 'This site has not provided a description.'
                                      : 'Loading site description…'}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${src.status === 'failing' ? 'bg-rose-400' : src.lastSyncedAt ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                                <span className={src.status === 'failing' ? 'text-rose-400' : undefined}>
                                  <span className="sr-only">{src.status === 'failing' ? 'Failing. ' : 'Active. '}</span>
                                  {src.status === 'failing'
                                    ? 'Failing'
                                    : src.lastSyncedAt
                                      ? formatSyncTime(src.lastSyncedAt)
                                      : 'Not synced yet'}
                                </span>
                                {categoryLabels.map(category => (
                                  <span key={category} className="flex items-center gap-x-1.5">
                                    <span className="text-slate-700">·</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCategoryDraft('');
                                        setCategoryEditorSourceId(src.id);
                                      }}
                                      title={`Edit categories for ${src.title}`}
                                      className="text-amber-300/70 hover:text-amber-200 transition"
                                    >
                                      {category}
                                    </button>
                                  </span>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCategoryDraft('');
                                    setCategoryEditorSourceId(categoryEditorSourceId === src.id ? null : src.id);
                                  }}
                                  aria-expanded={categoryEditorSourceId === src.id}
                                  aria-label={`Edit categories for ${src.title}`}
                                  title="Edit categories"
                                  className={`inline-flex items-center gap-1 transition ${
                                    categoryEditorSourceId === src.id ? 'text-amber-300' : 'text-slate-600 hover:text-amber-300'
                                  }`}
                                >
                                  <Sliders className="h-3 w-3 shrink-0" />
                                  {categoryLabels.length === 0 && <span>Categories</span>}
                                </button>
                              </div>
                              {src.failingReason && (
                                <span className="text-xs text-rose-400 block mt-1 break-words">{src.failingReason}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button 
                              type="button"
                              onClick={() => handleRefreshSource(src)}
                              disabled={isRefreshing}
                              className="p-2 min-w-10 min-h-10 flex items-center justify-center text-slate-400 hover:text-amber-400 transition"
                              title="Force refresh this feed"
                              aria-label="Force refresh this feed"
                            >
                              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-400' : ''}`} />
                            </button>
                            {pendingDeleteId === src.id && (
                              <span className="self-center pl-1 text-xs font-medium text-rose-300">Tap again to remove</span>
                            )}
                            <button 
                              type="button"
                              onClick={() => handleDeleteSource(src.id)}
                              className={`p-2 min-w-10 min-h-10 flex items-center justify-center rounded-xl border transition ${
                                pendingDeleteId === src.id
                                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-300'
                                  : 'border-transparent text-slate-400 hover:text-rose-400'
                              }`}
                              title={pendingDeleteId === src.id ? 'Tap again to confirm removal' : 'Remove source'}
                              aria-label={pendingDeleteId === src.id ? 'Tap again to confirm removal' : 'Remove source'}
                            >
                              {pendingDeleteId === src.id ? <AlertCircle className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                          </div>
                          {categoryEditorSourceId === src.id && (
                            <div className="px-3.5 sm:px-4 pb-3.5 sm:pb-4">
                              <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-3 sm:p-3.5 space-y-3">
                                <div className="space-y-0.5">
                                  <p className="text-xs font-medium text-slate-200">Categories</p>
                                  <p className="text-xs text-slate-400 leading-relaxed">{TAXONOMY_NOTE}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto overscroll-contain py-0.5">
                                  {sourceCategories.map(category => {
                                    const isSelected = normalizeCategoryLabels(src.categories, src.folder)
                                      .some(value => value.toLowerCase() === category.toLowerCase());
                                    return (
                                      <button
                                        key={category}
                                        type="button"
                                        onClick={() => toggleSourceCategory(src.id, category)}
                                        aria-pressed={isSelected}
                                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-2 text-xs leading-tight text-left transition ${
                                          isSelected
                                            ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
                                            : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                                        }`}
                                      >
                                        {isSelected && <Check className="w-3 h-3 shrink-0" />}
                                        <span className="min-w-0 break-words">{category}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                                <form
                                  className="flex gap-2"
                                  onSubmit={e => {
                                    e.preventDefault();
                                    addSourceCategory(src);
                                  }}
                                >
                                  <input
                                    type="text"
                                    maxLength={40}
                                    value={categoryDraft}
                                    onChange={e => setCategoryDraft(e.target.value)}
                                    placeholder="New category"
                                    aria-label={`Create a category for ${src.title}`}
                                    className="min-w-0 flex-1 rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                                  />
                                  <button
                                    type="submit"
                                    disabled={!categoryDraft.trim()}
                                    className="shrink-0 rounded-xl bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-xs font-medium text-amber-200 disabled:opacity-40"
                                  >
                                    Add
                                  </button>
                                </form>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              {sourceSearch.trim() && Object.keys(filteredSourcesByFolder).length === 0 && (
                <p className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-center text-sm text-slate-400">
                  No sources match “{sourceSearch.trim()}”. Try another name, folder, category, or feed URL.
                </p>
              )}
            </div>

            {/* Secondary: taking the subscription list somewhere else, not a primary action */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleExportOPML}
                title="Download every watched source as an OPML file, to import into another reader"
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export subscriptions (OPML)</span>
              </button>
            </div>

          </div>
        )}

        {/* TAB 4: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">Settings</h2>
            </div>


            {/* Weekly Reading Activity Summary in Settings */}
            <SettingsSection
              icon={<BarChart3 className="w-4 h-4" />}
              title="Weekly retrospective"
              meta={`${totalWeeklyMinutes}m · ${weeklyRecent.length} ${weeklyRecent.length === 1 ? 'article' : 'articles'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-400">Past 7 days</span>
                <button
                  type="button"
                  onClick={() => setShowWeeklyReviewModal(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Open full review</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <span className="text-xs text-slate-400 block mb-0.5">Time spent</span>
                  <span className="text-base font-bold font-serif text-slate-100">{totalWeeklyMinutes}m</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center">
                  <span className="text-xs text-slate-400 block mb-0.5">Finished</span>
                  <span className="text-base font-bold font-serif text-slate-100">{weeklyRecent.length}</span>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-center truncate">
                  <span className="text-xs text-slate-400 block mb-0.5">Focus</span>
                  <span className="text-xs font-bold text-amber-300 block leading-tight whitespace-normal">{topWeeklyTopic}</span>
                </div>
              </div>
            </SettingsSection>

            {/* Server-side request tally: plumbing, and only shown with the debug flag on */}
            {showDiagnostics && (
            <details className="group p-5 rounded-3xl border border-slate-700/70 bg-slate-900/40 space-y-4 open:border-slate-600/80 open:bg-slate-900/60">
              <summary className="flex items-start justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div>
                  <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-amber-400" />
                    <span>Server activity</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 transition-transform group-open:rotate-180" />
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Every request Curator has made, counted on the server. Kept for {usageStats?.retentionDays ?? 120} days. Open for the tally and cost estimate.
                  </p>
                </div>
              </summary>

              <div className="space-y-2">
                {([
                  ['Today', usageStats?.today],
                  ['Last 7 days', usageStats?.week],
                  ['Last 30 days', usageStats?.month],
                ] as Array<[string, any]>).map(([label, bucket]) => (
                  <div key={label} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-200">{label}</div>
                      <div className="text-xs text-slate-400 mt-0.5 break-words">
                        {bucket
                          ? `${bucket.outboundRequests} outbound · ${bucket.aiCalls} AI · ${bucket.apiCalls} app calls${bucket.feedFetches ? ` · ${bucket.feedFetches} feed fetches` : ''}`
                          : 'No tally yet'}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-amber-300">
                        {bucket ? `£${formatGbp(bucket.gbp)}` : '—'}
                      </div>
                      <div className="text-xs text-slate-400">
                        {bucket ? `$${bucket.usd.toFixed(4)}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {usageStats?.month && (usageStats.month.inputTokens > 0 || usageStats.month.outputTokens > 0) && (
                <p className="text-xs text-slate-400">
                  Tokens this month: {formatTokens(usageStats.month.inputTokens)} in
                  {usageStats.month.cachedInputTokens > 0 ? ` (${formatTokens(usageStats.month.cachedInputTokens)} cached)` : ''}
                  {' '}· {formatTokens(usageStats.month.outputTokens)} out
                </p>
              )}

              <p className="text-xs text-slate-400 leading-relaxed">
                Estimate at ${usageStats?.rates?.inputMiss ?? 0.15}/1M input, ${usageStats?.rates?.inputHit ?? 0.003}/1M cached input
                and ${usageStats?.rates?.output ?? 0.6}/1M output, converted at £1 = ${usageStats?.usdPerGbp ?? 1.32}.
                {usageStats?.peakNow ? ' Peak hours now — these calls bill at 2×.' : ' Peak hours (Mon–Fri, 01:00–04:00 and 06:00–10:00 UTC) double these rates.'}
              </p>

              <p className="text-xs text-slate-400">
                Counted inside the server container, so it survives app restarts but starts fresh on a redeploy.
              </p>
            </details>
            )}

            {/* Read aloud: the onboard voice and pace the reader speaks with */}
            <SettingsSection
              icon={<Volume2 className="w-4 h-4" />}
              title="Read aloud"
              meta={`${speechRate.toFixed(2)}×`}
            >
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Voice</label>
                <select
                  value={speechVoiceUri}
                  onChange={e => setSpeechVoiceUri(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500 cursor-pointer"
                >
                  <option value={SPEECH_VOICE_JAMIE_DEFAULT}>
                    Jamie (Premium){jamiePremiumSpeechVoice?.lang ? ` · ${jamiePremiumSpeechVoice.lang}` : ''} — default
                  </option>
                  <option value={SPEECH_VOICE_AUTO}>
                    {automaticSpeechVoice ? `Automatic — ${automaticSpeechVoice.name}` : 'Automatic — your device voice'}
                  </option>
                  {speechVoiceOptions
                    .filter(voice => voice.voiceURI !== jamiePremiumSpeechVoice?.voiceURI)
                    .map(voice => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} · {voice.lang}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-400 mt-1">
                  {speechVoiceOptions.length > 0
                    ? `${speechVoiceOptions.length} ${speechVoiceOptions.length === 1 ? 'voice' : 'voices'} on this device`
                    : 'Start Read aloud once to load this device’s voices.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center justify-between">
                  <span>Speed</span>
                  <span className="text-amber-300 tabular-nums">{speechRate.toFixed(2)}×</span>
                </label>
                <input
                  type="range"
                  min={SPEECH_RATE_MIN}
                  max={SPEECH_RATE_MAX}
                  step={0.05}
                  value={speechRate}
                  onChange={e => setSpeechRate(Number(e.target.value))}
                  className="w-full accent-amber-400"
                  aria-label="Read aloud speed"
                />
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Slower</span>
                  <span>Faster</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePreviewSpeech}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition"
              >
                Hear this voice
              </button>
            </SettingsSection>

            {/* Provider-configurable AI services */}
            <SettingsSection
              id="provider-settings"
              icon={<Sparkles className="w-4 h-4" />}
              title="Connect an AI service"
              meta="Optional"
            >
              <div
                role={startupApiStatus === 'issue' ? 'alert' : 'status'}
                aria-live={startupApiStatus === 'issue' ? 'assertive' : 'polite'}
                className={`rounded-xl border px-3 py-2 text-xs leading-relaxed space-y-1 ${
                  startupApiStatus === 'issue'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    : startupApiStatus === 'healthy'
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      startupApiStatus === 'issue' ? 'bg-amber-400' : startupApiStatus === 'healthy' ? 'bg-emerald-400' : 'bg-slate-500 animate-pulse'
                    }`} />
                    {startupApiStatus === 'checking' ? 'Checking server and APIs' : startupApiStatus === 'healthy' ? 'Server and API check passed' : 'Server or API needs attention'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void checkStartupServices()}
                    disabled={startupApiStatus === 'checking'}
                    className="shrink-0 underline underline-offset-2 disabled:opacity-50"
                  >
                    {startupApiStatus === 'checking' ? 'Checking…' : 'Check again'}
                  </button>
                </div>
                <p>{startupApiMessage}</p>
                <p className="text-xs opacity-75">A check sends one small request to your provider and may incur a charge.</p>
              </div>

              {/* Digest writing: the provider that writes the digest copy */}
              <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-950/40 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Digest writing</h4>

                {(() => {
                  const chatKey = customApiKey.trim();
                  const usesServerGemini = aiProvider === 'gemini' && serverGeminiAvailable;
                  const hasChatKey = Boolean(chatKey) || usesServerGemini;
                  const providerConfigured = aiProvider !== 'openai-compatible' || Boolean(aiBaseUrl.trim() && aiModel.trim());
                  const masked = chatKey ? `••••${chatKey.slice(-4)}` : '';

                  let heading = 'API key not active';
                  let detail = 'No key saved — digests use the built-in engine.';
                  let tone = 'border-amber-500/25 bg-amber-500/10 text-amber-300';

                  if (aiProvider === 'deterministic') {
                    heading = 'Built-in engine';
                    detail = 'No API key in use. Nothing is sent to an external service.';
                    tone = 'border-slate-800 bg-slate-950/60 text-slate-400';
                  } else if (!hasChatKey) {
                    heading = 'API key not active';
                    detail = 'No key saved yet — the built-in engine keeps writing your digest.';
                  } else if (!providerConfigured) {
                    heading = 'API key saved, provider incomplete';
                    detail = `The key (${masked || 'server'}) is stored, but the provider URL and model are missing.`;
                  } else {
                    heading = 'API key active';
                    detail = usesServerGemini
                      ? 'Using the server’s GEMINI_API_KEY for digests.'
                      : `Key saved in this browser (${masked}), sent only with your requests.`;
                    tone = 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300';
                  }

                  return (
                    <div className={`rounded-xl border px-3 py-2 text-xs leading-relaxed ${tone}`}>
                      <span className="font-semibold">{heading}.</span> {detail}
                    </div>
                  );
                })()}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Service</label>
                  <select
                    value={aiProvider}
                    onChange={e => setAiProvider(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500 cursor-pointer"
                  >
                    <option value="deterministic">Built-in (no external AI)</option>
                    <option value="openai-compatible">OpenAI or compatible service</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                {aiProvider === 'openai-compatible' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Provider URL</label>
                    <input
                      type="url"
                      value={aiBaseUrl}
                      onChange={e => setAiBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">HTTPS API URL from your provider.</p>
                  </div>
                )}

                {aiProvider !== 'deterministic' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Model name</label>
                      <input
                        type="text"
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        placeholder={aiProvider === 'openai-compatible' ? 'e.g. gpt-4o-mini or provider model ID' : aiProvider === 'anthropic' ? 'e.g. claude-3-5-sonnet-20241022' : 'e.g. gemini-2.5-flash'}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Provider API key</label>
                      <input
                        type="password"
                        value={customApiKey}
                        onChange={e => setCustomApiKey(e.target.value)}
                        placeholder="Your provider API key"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                      />
                      <p className="text-xs text-slate-400 mt-1">Stored in this browser, then forwarded only to your provider.</p>
                    </div>

                    <ProviderTestButton
                      kind="chat"
                      provider={aiProvider}
                      apiKey={customApiKey}
                      baseUrl={aiBaseUrl}
                      model={aiModel}
                      disabled={loadingDigest}
                    />
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    generateDigest({ fresh: true });
                    showToast('Writing service applied — refreshing your digest');
                  }}
                  disabled={loadingDigest}
                  className="w-full px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
                >
                  Apply & refresh digest
                </button>
              </div>

              {/* Deeper matching: optional embeddings that sharpen ranking, configured apart */}
              <div className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-950/40 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Deeper matching</h4>

                <div>
                  <label htmlFor="topic-matching-service" className="block text-xs font-medium text-slate-300 mb-1.5">Service</label>
                  <select
                    id="topic-matching-service"
                    value={embeddingProvider}
                    onChange={e => {
                      const nextProvider = e.target.value;
                      setEmbeddingProvider(nextProvider);
                      setEmbeddingModel(current => {
                        if (current === 'text-embedding-3-small' || current === 'gemini-embedding-001') {
                          return nextProvider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small';
                        }
                        return current;
                      });
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500 cursor-pointer"
                  >
                    <option value="openai-compatible">
                      {`OpenAI or compatible service${(embeddingApiKey.trim() || (embeddingKeyMatchesChatProvider && customApiKey.trim())) ? '' : ' (needs a key)'}`}
                    </option>
                    <option value="gemini">
                      {`Google Gemini${(embeddingApiKey.trim() || (embeddingKeyMatchesChatProvider && customApiKey.trim()) || serverGeminiAvailable) ? '' : ' (needs a key)'}`}
                    </option>
                    <option value="none">Off — use built-in matching</option>
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Matches by meaning, not just shared words.</p>
                  {(() => {
                    const hasEmbeddingKey = Boolean(embeddingApiKey.trim() || (embeddingKeyMatchesChatProvider && customApiKey.trim()));
                    const hasEmbeddingBase = Boolean(embeddingBaseUrl.trim() || (embeddingKeyMatchesChatProvider && aiBaseUrl.trim()));
                    const embeddingActive =
                      embeddingProvider === 'gemini'
                        ? Boolean(hasEmbeddingKey || serverGeminiAvailable)
                        : embeddingProvider === 'openai-compatible'
                          ? Boolean(hasEmbeddingKey && hasEmbeddingBase)
                          : false;
                    const serviceName = embeddingProvider === 'gemini' ? 'Google Gemini' : 'OpenAI-compatible service';
                    return (
                      <p className={`text-xs mt-1 font-medium ${embeddingActive ? 'text-emerald-300' : 'text-amber-300'}`}>
                        {embeddingProvider === 'none'
                          ? 'Currently matching with: Built-in engine (no key needed).'
                          : embeddingActive
                            ? `Currently matching with: ${serviceName}.`
                            : `Currently matching with: Built-in engine — ${serviceName} has no working key yet.`}
                      </p>
                    );
                  })()}
                </div>

                {embeddingProvider === 'openai-compatible' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Provider URL</label>
                      <input
                        type="url"
                        value={embeddingBaseUrl}
                        onChange={e => setEmbeddingBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Matching model name</label>
                      <input
                        type="text"
                        value={embeddingModel}
                        onChange={e => setEmbeddingModel(e.target.value)}
                        placeholder="text-embedding-3-small"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                      />
                    </div>
                  </>
                )}

                {embeddingProvider === 'gemini' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Matching model name</label>
                    <input
                      type="text"
                      value={embeddingModel}
                      onChange={e => setEmbeddingModel(e.target.value)}
                      placeholder="gemini-embedding-001"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                    />
                  </div>
                )}

                {embeddingProvider !== 'none' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Provider API key (optional)</label>
                    <input
                      type="password"
                      value={embeddingApiKey}
                      onChange={e => setEmbeddingApiKey(e.target.value)}
                      placeholder="Optional — blank reuses the chat key"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">Stored in this browser. HTTPS only.</p>
                  </div>
                )}

                {embeddingProvider !== 'none' && (
                  <ProviderTestButton
                    kind="embedding"
                    provider={embeddingProvider}
                    apiKey={embeddingApiKey || (embeddingKeyMatchesChatProvider ? customApiKey : '')}
                    baseUrl={embeddingBaseUrl || (embeddingKeyMatchesChatProvider ? aiBaseUrl : '')}
                    model={embeddingModel}
                    disabled={loadingDigest}
                  />
                )}

                {embeddingProvider !== 'none' && (
                  <button
                    type="button"
                    onClick={() => {
                      generateDigest({ fresh: true });
                      showToast('Matching service applied — re-ranking your digest');
                    }}
                    disabled={loadingDigest}
                    className="w-full px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition disabled:opacity-50"
                  >
                    Apply & re-match
                  </button>
                )}
              </div>
            </SettingsSection>

            {/* Browser-local semantic reading profile */}
            <SettingsSection
              icon={<Sliders className="w-4 h-4" />}
              title="Your reading preferences"
              meta={`${semanticFeedback.length}/40 votes`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  {semanticFeedback.filter(item => item.vote === 'like').length} liked · {semanticFeedback.filter(item => item.vote === 'dislike').length} disliked
                </p>
                {(semanticFeedback.length > 0 || signals.moreIds.length > 0 || signals.lessIds.length > 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!pendingReset) {
                        setPendingReset(true);
                        showToast('Tap Reset again to confirm — this clears your votes and signals');
                        return;
                      }
                      setPendingReset(false);
                      setSemanticFeedback([]);
                      setSignals({ moreTopics: [], lessTopics: [], moreIds: [], lessIds: [], more: [], less: [] });
                      showToast('Reading preferences reset');
                    }}
                    className={`text-xs transition shrink-0 ${
                      pendingReset
                        ? 'text-rose-400 font-semibold'
                        : 'text-slate-400 hover:text-rose-400'
                    }`}
                  >
                    {pendingReset ? 'Tap again to confirm reset' : 'Reset profile'}
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={openSetupWizard}
                className="w-full px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800 text-xs font-medium text-amber-300 hover:border-amber-500/40 hover:text-amber-200 transition flex items-center justify-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{semanticFeedback.length > 0 ? 'Teach Curator with more articles' : 'Teach Curator with articles'}</span>
              </button>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300">
                <div className="flex items-center gap-2 font-medium">
                  <span className={`w-2 h-2 rounded-full ${embeddingProvider === 'none' || semanticServiceReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {embeddingProvider === 'none'
                    ? 'Built-in topic matching is active'
                    : semanticServiceReady
                      ? `Built-in matching + ${embeddingProvider === 'gemini' ? 'Google Gemini' : 'external'} topic matching`
                      : 'Built-in matching · add a service key for richer matching'}
                </div>
                {semanticSummary && (
                  <p className="text-xs text-slate-400 mt-2">
                    Last digest · {semanticSummary.feedbackExamples} vote example{semanticSummary.feedbackExamples === 1 ? '' : 's'} ·{' '}
                    {semanticSummary.providerVectors > 0
                      ? `${semanticSummary.providerVectors} AI-matched stories`
                      : 'built-in matching only'} ·{' '}
                    {semanticSummary.deprioritized} down-ranked
                  </p>
                )}
                <details className="mt-2 text-xs text-slate-400">
                  <summary className="cursor-pointer font-medium text-slate-300">What happens to my data?</summary>
                  <p className="mt-2 leading-relaxed">
                    Votes and excerpts stay in this browser and are sent to Curator's server for ranking. External
                    matching also sends them to your provider; nothing is stored in a database.
                  </p>
                </details>
              </div>
            </SettingsSection>

            {/* Declared interests: nudges for the ranking, never a filter */}
            <SettingsSection
              icon={<Compass className="w-4 h-4" />}
              title="Interests"
              meta={interests.more.length || interests.less.length
                ? `${interests.more.length} more · ${interests.less.length} less`
                : 'None yet'}
            >
              <InterestsEditor
                value={interests}
                suggestions={interestSuggestions}
                onChange={setInterests}
              />
            </SettingsSection>


          </div>
        )}

        {/* TAB 5: FEEDS (Traditional Reading Stream) */}
        {activeTab === 'feeds' && (
          <div className="space-y-6 animate-fade-in w-full max-w-full">
            {/* Top Circular Source Stories Carousel */}
            <div className="overflow-x-auto no-scrollbar py-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
              <div className="flex items-center gap-4 min-w-max">
                {/* "All" feeds circle */}
                <button
                  type="button"
                  onClick={() => handleOpenFeedStream('all')}
                  className="flex flex-col items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  <div className={`relative w-16 h-16 rounded-full p-0.5 transition-transform group-hover:scale-105 ${
                    !selectedFeedSource || selectedFeedSource === 'all'
                      ? 'bg-amber-400 ring-2 ring-amber-400/50'
                      : 'bg-slate-800'
                  }`}>
                    <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950">
                      <span className="text-xs font-bold text-slate-200">ALL</span>
                    </div>
                  </div>
                  <span className={`text-xs font-medium max-w-[72px] truncate text-center ${
                    !selectedFeedSource || selectedFeedSource === 'all' ? 'text-amber-400 font-semibold' : 'text-slate-400'
                  }`}>
                    All Feeds
                  </span>
                </button>

                {sources.map((src) => {
                  const isSelected = selectedFeedSource === src.title;
                  const isUnread = !readSourceIds.includes(src.id);
                  const avatarUrl = getSourceAvatar(src.feedUrl);
                  return (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => handleOpenFeedStream(src.title, src.id)}
                      className="flex flex-col items-center gap-2 group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                      title={isUnread ? `${src.title} (Unread)` : `${src.title} (Read)`}
                    >
                      <div className={`relative w-16 h-16 rounded-full p-0.5 transition-transform group-hover:scale-105 ${
                        isSelected
                          ? 'bg-amber-400 ring-2 ring-amber-400/50'
                          : isUnread
                          ? 'bg-gradient-to-tr from-amber-500 to-rose-500 shadow-md'
                          : 'bg-slate-800'
                      }`}>
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center overflow-hidden border-2 border-slate-950 relative">
                          {avatarUrl ? (
                            <img 
                              src={avatarUrl} 
                              alt={src.title} loading="lazy" 
                              className="w-full h-full object-cover rounded-full"
                              onLoad={markTinyIcon}
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                                const fallback = e.currentTarget.parentElement?.querySelector('.feed-circle-initials');
                                if (fallback) fallback.classList.remove('hidden');
                              }}
                            />
                          ) : null}
                          <span className={`feed-circle-initials text-xs font-bold ${avatarUrl ? 'hidden' : ''} ${isUnread ? 'text-slate-100' : 'text-slate-400'}`}>
                            {src.title.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        {isUnread && !isSelected && (
                          <div 
                            className="absolute top-0 right-0 w-3.5 h-3.5 rounded-full bg-orange-500 border-2 border-slate-950 shadow-sm z-10"
                            title="Unread entries"
                          />
                        )}
                      </div>
                      <span className={`text-xs font-medium max-w-[76px] truncate text-center group-hover:text-amber-300 transition-colors ${
                        isSelected ? 'text-amber-300 font-semibold' : isUnread ? 'text-slate-200 font-semibold' : 'text-slate-400'
                      }`}>
                        {getShortSourceTitle(src.title)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Stream Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-900 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                    {selectedFeedSource && selectedFeedSource !== 'all' ? selectedFeedSource : 'All Feeds Stream'}
                  </h2>
                  {selectedFeedSource && selectedFeedSource !== 'all' && (
                    <span className="text-xs uppercase font-mono tracking-wider bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                      Feed Stream
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loadingFeedStream
                    ? 'Loading stream…'
                    : `Traditional chronological reading stream · ${feedStreamArticles.length} ${feedStreamArticles.length === 1 ? 'entry' : 'entries'}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRefreshAllFeeds()}
                  disabled={refreshingAllFeeds}
                  className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-300 hover:border-amber-500/30 transition flex items-center gap-1.5 disabled:opacity-50"
                  title="Re-read every feed in your library"
                  aria-label="Refresh all feeds"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingAllFeeds ? 'animate-spin' : ''}`} />
                  <span>{refreshingAllFeeds ? 'Refreshing…' : 'Refresh all'}</span>
                </button>
                {sources.some(s => !readSourceIds.includes(s.id)) ? (
                  <button
                    type="button"
                    onClick={markAllSourcesAsRead}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-amber-300 hover:border-amber-500/30 transition flex items-center gap-1.5"
                    title="Dismiss all unread orange dots"
                  >
                    <CheckCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Mark all read</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={markAllSourcesAsUnread}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-slate-200 transition text-xs"
                    title="Reset unread dots"
                  >
                    Reset unread dots
                  </button>
                )}

                {selectedFeedSource && selectedFeedSource !== 'all' && (
                  <button
                    type="button"
                    onClick={() => handleOpenFeedStream('all')}
                    className="px-3 py-1.5 text-xs font-medium rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 transition"
                  >
                    View all feeds
                  </button>
                )}
              </div>
            </div>

            {/* Article Stream */}
            {loadingFeedStream ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto text-amber-500" />
                <p className="text-sm">Loading feed stream...</p>
              </div>
            ) : feedStreamArticles.length === 0 ? (
              <div className="py-20 text-center text-slate-400 space-y-2">
                <p className="text-sm">No entries found for this feed.</p>
                <button
                  type="button"
                  onClick={() => handleOpenFeedStream('all')}
                  className="text-xs text-amber-400 underline"
                >
                  Return to all feeds stream
                </button>
              </div>
            ) : (
              <div key={`stream-${feedStreamRenderKey}`} className="space-y-6">
                {feedStreamArticles.map((item) => {
                  const actions = getCardActions(item.id);
                  return (
                    <article
                      key={item.id}
                      onClick={() => openArticle(item)}
                      // A card is a reading surface, not a button: a short name, and the four actions
                      // inside it stay separately announced instead of being flattened into one label.
                      aria-label={`${item.title} — ${item.source}`}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openArticle(item);
                        }
                      }}
                      className={`group ${compactCards ? 'rounded-2xl' : 'rounded-3xl'} transition-all duration-300 cursor-pointer overflow-hidden relative ${
                        actions.hasAnyAction
                          ? 'bg-slate-900/95 border-2 border-emerald-500/60 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(16,185,129,0.35)] hover:border-emerald-400 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(16,185,129,0.5)]'
                          : 'bg-slate-900/95 border-2 border-slate-700/80 shadow-[0_22px_50px_-8px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.12)] hover:border-amber-500/60 hover:shadow-[0_28px_60px_-8px_rgba(0,0,0,0.98),0_0_0_1.5px_rgba(245,158,11,0.35)]'
                      }`}
                    >
                      <div className={`${compactCards ? 'p-4 pb-2' : 'p-5 pb-3'} flex items-center justify-between`}>
                        <div className="flex items-center gap-3 min-w-0">
                          {(() => {
                            const itemAvatar = getSourceAvatar(item.url);
                            return (
                              <div className="w-9 h-9 rounded-full bg-slate-900 border border-slate-700 flex items-center justify-center overflow-hidden shrink-0 relative">
                                {itemAvatar ? (
                                  <img 
                                    src={itemAvatar} 
                                    alt={item.source} loading="lazy"
                                    className="w-full h-full object-cover rounded-full"
                                    onLoad={markTinyIcon}
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                      const fallback = e.currentTarget.parentElement?.querySelector('.stream-card-initials');
                                      if (fallback) fallback.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <span className={`stream-card-initials text-xs font-bold text-amber-400 ${itemAvatar ? 'hidden' : ''}`}>
                                  {item.source.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                            );
                          })()}
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                              <span className="truncate">{item.source}</span>
                            </div>
                            <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
                              {item.publishedAt && (
                                <>
                                  <span className="min-w-0">{decodeArticleEntities(item.publishedAt)}</span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span className="min-w-0">{displayFolder(item.folder)}</span>
                              <span aria-hidden="true">·</span>
                              <span className="shrink-0 font-medium text-slate-300">{decodeArticleEntities(item.readTime || '')}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {actions.isReadThrough ? (
                            <div 
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-xs font-bold text-emerald-300 shadow-sm"
                              title="Read through completed"
                            >
                              <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                              <span>Read</span>
                            </div>
                          ) : actions.isVotedMore ? (
                            <div className="flex items-center px-2 py-1 rounded-full bg-amber-950/90 border border-amber-500/50" title="More like this">
                              <ThumbsUp className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                          ) : actions.isVotedLess ? (
                            <div className="flex items-center px-2 py-1 rounded-full bg-rose-950/90 border border-rose-500/50" title="Less like this">
                              <ThumbsDown className="w-3.5 h-3.5 text-rose-400" />
                            </div>
                          ) : actions.isClicked ? (
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-950/90 border border-sky-500/40 text-xs font-medium text-sky-300">
                              <span>Opened</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700/60 text-xs font-medium text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              <span>New</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {!item.bannerImage && (
                        <div className={`mx-3.5 rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 flex items-center justify-center ${compactCards ? 'h-24' : 'h-32'}`}>
                          <div className="text-center px-4">
                            <CuratorMark className="w-7 h-7 mx-auto mb-1.5 opacity-80" />
                            <div className="text-xs uppercase font-bold tracking-wider text-amber-400/90">{displayFolder(item.folder)}</div>
                          </div>
                        </div>
                      )}
                      {item.bannerImage && (
                        <div className={`relative mx-3.5 rounded-2xl overflow-hidden ${compactCards ? 'h-40 md:h-48' : 'h-56 md:h-64'} shadow-lg border border-slate-700/60`}>
                          <img 
                            src={item.bannerImage} 
                            alt={item.title} 
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                          
                        </div>
                      )}

                      <div className={`${compactCards ? 'p-4 space-y-3 pt-3' : 'p-5 space-y-4 pt-4'}`}>
                        <div>
                          {item.bannerImage && (
                            <div className="text-xs uppercase font-bold tracking-wider text-amber-400/90 mb-1">
                              {displayFolder(item.folder)}
                            </div>
                          )}
                          <h3 className={`${compactCards ? 'text-lg' : 'text-xl'} font-bold tracking-tight text-slate-100 group-hover:text-amber-300 transition-colors`}>
                            {item.title}
                          </h3>
                          <p className={`${compactCards ? 'text-xs line-clamp-1' : 'text-sm line-clamp-2'} text-slate-400 mt-1`}>
                            {item.summary}
                          </p>
                        </div>

                        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openArticle(item); }}
                              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-amber-300 hover:text-amber-200 transition"
                            >
                              Read in Curator <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={item.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.stopPropagation();
                                setReadArticleIds(prev => (prev.includes(item.id) ? prev : [...prev, item.id]));
                                showToast(`Opening source on ${item.source}`);
                              }}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-amber-300 transition-colors"
                              title={`Read original on ${item.source} (opens external browser or app)`}
                              aria-label={`Read original on ${item.source}`}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleSave(item); }}
                              className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition ${
                                savedIds.includes(item.id)
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                                  : 'border-transparent text-slate-400 hover:text-amber-300'
                              }`}
                              title={savedIds.includes(item.id) ? 'Remove from saved' : 'Save for later'}
                              aria-label={savedIds.includes(item.id) ? `Remove "${item.title}" from saved` : `Save "${item.title}" for later`}
                              aria-pressed={savedIds.includes(item.id)}
                            >
                              <Bookmark className={`w-4 h-4 ${savedIds.includes(item.id) ? 'fill-amber-400 text-amber-400' : ''}`} />
                            </button>
                          </div>
                          <FeedbackActions
                            isMore={actions.isVotedMore}
                            isLess={actions.isVotedLess}
                            onMore={() => handleMore(item)}
                            onLess={() => handleLess(item)}
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>


      {/* Bottom Dock Navigation */}
      <nav inert={backgroundInert} className="fixed safe-dock left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-lg bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl py-2.5 px-3 shadow-2xl">
        <div className="flex items-center justify-around">
          <button 
            type="button"
            onClick={() => setActiveTab('today')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'today' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Home className="w-5 h-5" />
            <span className="text-xs tracking-tight">Today</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('feeds')}
            aria-label={unreadSourceCount > 0 ? `Feeds, ${unreadSourceCount} unread` : 'Feeds'}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'feeds' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Rss className="w-5 h-5" />
              {unreadSourceCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-slate-950">
                  {unreadSourceCount > 9 ? '9+' : unreadSourceCount}
                </span>
              )}
            </div>
            <span className="text-xs tracking-tight">Feeds</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('saved')}
            aria-label={savedIds.length > 0 ? `Saved, ${savedIds.length} saved` : 'Saved'}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'saved' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <div className="relative">
              <Bookmark className="w-5 h-5" />
              {savedIds.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold leading-none text-slate-950">
                  {savedIds.length > 9 ? '9+' : savedIds.length}
                </span>
              )}
            </div>
            <span className="text-xs tracking-tight">Saved</span>
          </button>

          <button 
            type="button"
            onClick={() => setActiveTab('sources')}
            className={`flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 relative transition ${activeTab === 'sources' ? 'text-amber-400 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-xs tracking-tight">Sources</span>
          </button>

        </div>
      </nav>

      {showStartupApiPrompt && createPortal(
        <div className="fixed inset-0 z-[110] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 safe-modal">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="startup-api-alert-title"
            aria-describedby="startup-api-alert-message"
            className="w-full max-w-md rounded-3xl bg-slate-900 border border-amber-500/30 p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 id="startup-api-alert-title" className="text-base font-semibold text-slate-100">Service check needs attention</h2>
                <p id="startup-api-alert-message" className="text-sm text-amber-200 mt-1 leading-relaxed">{startupApiMessage}</p>
              </div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Settings are open. If a provider failed, update its URL, model, or key. If Curator’s server is unreachable, retry when your connection is back. You can also ignore this warning for now.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowStartupApiPrompt(false);
                  setActiveTab('settings');
                  setShowSetupWizard(false);
                  window.setTimeout(() => {
                    document.getElementById('provider-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 150);
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition"
              >
                Update settings
              </button>
              <button
                type="button"
                onClick={() => setShowStartupApiPrompt(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs font-medium text-slate-300 hover:text-slate-100 transition"
              >
                Ignore
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add Source Modal — portalled as well, so it paints above the setup wizard */}
      {showAddSourceModal && createPortal(
        <div className="fixed inset-0 z-[85] bg-slate-950/85 backdrop-blur-md flex items-start justify-center p-4 safe-modal overflow-y-auto overscroll-contain">
          <div
            ref={addSourceOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-source-title"
            className="w-full max-w-md my-auto rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 id="add-source-title" className="text-lg font-semibold text-slate-100">Add New Source</h3>
              <button type="button" onClick={() => setShowAddSourceModal(false)} title="Close" aria-label="Close the Add Source form" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddSource} noValidate className="space-y-4">
              <div>
                <label htmlFor="new-source-title" className="block text-xs font-medium text-slate-400 mb-1">Source Title</label>
                <input
                  id="new-source-title"
                  type="text"
                  required
                  placeholder="e.g. Marginal Revolution"
                  value={newSourceTitle}
                  onChange={e => { setNewSourceTitle(e.target.value); setNewSourceTitleError(null); }}
                  aria-invalid={newSourceTitleError ? true : undefined}
                  className={`w-full rounded-xl bg-slate-950 border px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500 ${newSourceTitleError ? 'border-rose-500' : 'border-slate-800'}`}
                />
                {newSourceTitleError && (
                  <p role="alert" className="text-xs text-rose-400 mt-1">{newSourceTitleError}</p>
                )}
              </div>
              <div>
                <label htmlFor="new-source-url" className="block text-xs font-medium text-slate-400 mb-1">RSS / Atom Feed URL</label>
                <input
                  id="new-source-url"
                  type="url"
                  required
                  placeholder="https://example.com/feed.xml"
                  value={newSourceUrl}
                  onChange={e => { setNewSourceUrl(e.target.value); setNewSourceUrlError(null); }}
                  aria-invalid={newSourceUrlError ? true : undefined}
                  className={`w-full rounded-xl bg-slate-950 border px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500 ${newSourceUrlError ? 'border-rose-500' : 'border-slate-800'}`}
                />
                {newSourceUrlError && (
                  <p role="alert" className="text-xs text-rose-400 mt-1">{newSourceUrlError}</p>
                )}
              </div>
              <div>
                <label htmlFor="new-source-folder" className="block text-xs font-medium text-slate-400 mb-1">Folder</label>
                <select
                  id="new-source-folder"
                  value={newSourceFolderCustom ? '__new__' : newSourceFolder}
                  onChange={e => {
                    if (e.target.value === '__new__') {
                      setNewSourceFolderCustom(true);
                      setNewSourceFolder('');
                    } else {
                      setNewSourceFolderCustom(false);
                      setNewSourceFolder(e.target.value);
                    }
                  }}
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                >
                  {sourceFolders.map(folder => <option key={folder} value={folder}>{folder}</option>)}
                  <option value="__new__">Create a new folder…</option>
                </select>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">{TAXONOMY_NOTE}</p>
                {newSourceFolderCustom && (
                  <input
                    type="text"
                    required
                    autoFocus
                    aria-label="New folder name"
                    placeholder="New folder name"
                    value={newSourceFolder}
                    onChange={e => setNewSourceFolder(e.target.value)}
                    className="mt-2 w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
                  />
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddSourceModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition"
                >
                  Add Source
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* First-run semantic setup — portalled to <body> so the overlay always covers
          the whole screen (header and dock included), whichever tab opened it */}
      {showSetupWizard && createPortal(
        <div className="fixed inset-0 z-[80] bg-slate-950/90 backdrop-blur-md flex items-start justify-center p-4 safe-modal overflow-y-auto overscroll-contain">
          <div
            ref={wizardOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-label="Set up Curator"
            className="w-full max-w-lg my-auto rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-5 animate-fade-in"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-amber-400/90 font-semibold">
                  Setup · step {setupStep} of 3
                </p>
                <h3 className="text-lg font-semibold text-slate-100 mt-1">
                  {setupStep === 1
                    ? 'Set up your semantic curator'
                    : setupStep === 2
                      ? 'Teach it in ten taps'
                      : 'Your engine is ready'}
                </h3>
              </div>
              <button
                type="button"
                onClick={dismissSetupWizard}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-200"
                title="Skip setup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map(step => (
                <span
                  key={step}
                  className={`h-1 flex-1 rounded-full transition-colors ${step <= setupStep ? 'bg-amber-500' : 'bg-slate-800'}`}
                />
              ))}
            </div>

            {setupStep === 1 && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Curator ranks your feeds by similarity to what you vote on. That profile comes from a few quick
                  verdicts below and stays in this browser — no account, no key, no third-party calls.
                </p>

                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Feeds in your library</span>
                    <span className="font-semibold text-slate-100">{sources.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Votes already in your profile</span>
                    <span className="font-semibold text-slate-100">{semanticFeedback.length}</span>
                  </div>
                </div>

                {setupError && (
                  <p className="text-xs text-rose-400 leading-relaxed">{setupError}</p>
                )}

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={loadCalibration}
                    disabled={loadingCalibration}
                    className="w-full px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-amber-400 transition disabled:opacity-60"
                  >
                    {loadingCalibration ? (
                      <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scanning your feeds…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5" /> Scan my feeds and calibrate</>
                    )}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={openImportModal}
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 transition"
                    >
                      Import OPML
                    </button>
                    <button
                      type="button"
                      onClick={finishSetup}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-3 text-xs font-medium text-slate-400 transition hover:text-slate-200"
                    >
                      Skip for now
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  No provider keys needed. Deeper matching through an OpenAI-compatible or Gemini service is an optional upgrade in Settings.
                </p>
              </div>
            )}

            {setupStep === 2 && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Say what you would read and what you would not. Titles and excerpts only — the built-in engine
                  scores them on this app's server.
                </p>

                {currentCalibrationItem ? (
                  <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="text-xs text-slate-400">
                      {currentCalibrationItem.source} · {currentCalibrationItem.folder}
                    </div>
                    <h4 className="text-sm font-semibold text-slate-100 leading-snug">
                      {currentCalibrationItem.title}
                    </h4>
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
                      {currentCalibrationItem.summary}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => answerCalibration(currentCalibrationItem, 'like')}
                        className="flex-1 min-h-11 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center justify-center hover:bg-emerald-500/25 transition"
                        title="More like this"
                        aria-label="More like this"
                      >
                        <ThumbsUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => answerCalibration(currentCalibrationItem, 'dislike')}
                        className="flex-1 min-h-11 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center justify-center hover:bg-rose-500/20 transition"
                        title="Not for me"
                        aria-label="Not for me"
                      >
                        <ThumbsDown className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-4 text-xs font-medium text-slate-400">
                      <span className="flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3 text-emerald-400/70" /> read it
                      </span>
                      <span className="flex items-center gap-1">
                        <ThumbsDown className="w-3 h-3 text-rose-400/70" /> skip it
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-center text-xs text-slate-300">
                    <Check className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                    {calibrationVotes} verdict{calibrationVotes === 1 ? '' : 's'} recorded. That is enough to
                    rank today's digest.
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {Math.min(calibrationIndex, calibrationCandidates.length)} of {calibrationCandidates.length} reviewed
                  </span>
                  <button
                    type="button"
                    onClick={() => setSetupStep(3)}
                    className="inline-flex min-h-11 items-center px-2 -mr-2 font-medium text-amber-400 transition hover:text-amber-300"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {setupStep === 3 && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-2 font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    Built-in semantic engine: on
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {calibrationVotes > 0
                      ? `Ranking from ${calibrationVotes} calibration verdict${calibrationVotes === 1 ? '' : 's'} plus any earlier votes.`
                      : 'Ranking from the votes you cast on digest cards.'}
                    {' '}No key and no third-party calls. Refreshing the digest rotates in pieces you have not seen.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={finishSetup}
                    className="w-full px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 transition"
                  >
                    Build my digest
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      finishSetup();
                      setActiveTab('settings');
                    }}
                    className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-slate-100 transition"
                  >
                    Connect an AI service for deeper matching (optional)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSetupStep(2)}
                    className="text-xs text-slate-400 hover:text-slate-200 transition"
                  >
                    Back to calibration
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* OPML Import Modal */}
      {showImportModal && createPortal(
        <div className="fixed inset-0 z-[85] bg-slate-950/85 backdrop-blur-md flex items-start justify-center p-4 safe-modal overflow-y-auto overscroll-contain">
          <div
            ref={importOverlayRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="opml-import-title"
            className="w-full max-w-lg my-auto rounded-3xl bg-slate-900 border border-slate-800 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 id="opml-import-title" className="text-lg font-semibold text-slate-100">Import Subscription List (OPML)</h3>
              <button type="button" onClick={() => setShowImportModal(false)} title="Close" aria-label="Close the OPML import form" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Upload your reader’s <span className="text-slate-200 font-medium">.opml</span> or <span className="text-slate-200 font-medium">.xml</span> export file in one step, or paste its contents below. Folders are preserved, and anything you already follow is skipped — importing never replaces your list.
            </p>

            {/* File Upload Dropzone */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".opml,.xml,text/xml,application/xml,text/x-opml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleOpmlFileSelected(file);
                }
                e.target.value = '';
              }}
            />
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOpml(true);
              }}
              onDragLeave={() => setIsDraggingOpml(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOpml(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  handleOpmlFileSelected(file);
                }
              }}
              className={`rounded-2xl border-2 border-dashed p-5 text-center cursor-pointer transition ${
                isDraggingOpml
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-slate-700 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-950'
              }`}
            >
              <FileUp className="w-6 h-6 text-amber-400 mx-auto mb-2" />
              <div className="text-xs font-medium text-slate-200">
                {importFileName ? `Selected: ${importFileName}` : 'Choose an OPML / XML file or drop it here'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Supports standard exports from Feedly, NetNewsWire, Reeder, Substack, and Inoreader
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="opml-text" className="block text-xs font-medium text-slate-400">
                Or paste OPML XML directly
              </label>
              <textarea 
                id="opml-text"
                rows={5}
                placeholder="<?xml version='1.0' encoding='UTF-8'?><opml>...</opml>"
                value={importText}
                onChange={e => setImportText(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-800 p-3 text-xs text-slate-200 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 focus:border-amber-500"
              />
            </div>

            {pendingImportText && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs space-y-2.5">
                <p className="leading-relaxed">
                  You already follow {sources.length} {sources.length === 1 ? 'source' : 'sources'}. This adds only
                  the feeds in the file that are not in your list yet; nothing already here is removed.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const text = pendingImportText;
                      setPendingImportText(null);
                      void processOpmlText(text, { skipConfirm: true });
                    }}
                    className="min-h-11 rounded-xl bg-amber-500 px-3 font-semibold text-slate-950 transition hover:bg-amber-400"
                  >
                    Add the new feeds
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingImportText(null)}
                    className="min-h-11 rounded-xl border border-amber-500/30 px-3 font-medium text-amber-200 transition hover:bg-amber-500/10"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {importError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{importError}</span>
              </div>
            )}

            {importResult && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-2">
                <div className="font-medium">
                  Added {importResult.totalImported} {importResult.totalImported === 1 ? 'feed' : 'feeds'}
                  {' '}({importResult.successCount} active, {importResult.failCount} failing)
                  {importResult.duplicates ? ` · ${importResult.duplicates} already in your list` : ''}.
                </div>
                {importResult.failures && importResult.failures.length > 0 && (
                  <ul className="space-y-1 text-xs text-amber-300 border-t border-emerald-500/20 pt-2">
                    {importResult.failures.map((f, idx) => (
                      <li key={idx}>
                        {f.title}: {f.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button 
                type="button" 
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                Close
              </button>
              <button 
                type="button"
                disabled={isImportingOpml || !importText.trim()}
                onClick={handleImportOPML}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-amber-500 text-slate-950 font-semibold hover:bg-amber-400 transition disabled:opacity-50"
              >
                {isImportingOpml ? 'Importing...' : 'Process Import'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Edition settings: count, density and serendipity, out of the reading path */}
      {showDigestSettings && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="digest-settings-title"
          className="fixed inset-0 z-[90] bg-slate-950/80 backdrop-blur-md flex items-end sm:items-center justify-center"
          onClick={() => setShowDigestSettings(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-800 bg-slate-900 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="digest-settings-title" className="text-base font-semibold text-slate-100">{editionSheetTitle}</h3>
                <p className="text-xs text-slate-400 mt-0.5">How long it is, and how far it wanders.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDigestSettings(false)}
                aria-label="Close edition settings"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <span className="block text-xs font-medium text-slate-300 mb-2">Stories per edition</span>
              <div role="group" aria-label="Stories per edition" className="grid grid-cols-5 gap-1.5">
                {DIGEST_ITEM_COUNTS.map(num => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setItemCount(num)}
                    aria-pressed={itemCount === num}
                    className={`min-h-11 rounded-xl text-sm font-medium transition ${
                      itemCount === num ? 'bg-slate-800 text-slate-100 shadow-inner' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCompactCards(value => !value)}
              aria-pressed={compactCards}
              className="flex w-full min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-800 px-3 text-xs"
            >
              <span className="font-medium text-slate-200">Compact cards</span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${compactCards ? 'bg-amber-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-slate-950 transition-all ${compactCards ? 'left-[1.4rem]' : 'left-0.5'}`} />
              </span>
            </button>

            <div>
              <label htmlFor="serendipity-slider" className="flex items-baseline justify-between text-xs font-medium text-slate-300">
                <span>Serendipity</span>
                <span className="text-amber-300">{serendipityDial}%</span>
              </label>
              <input
                id="serendipity-slider"
                type="range"
                min="0"
                max="100"
                value={serendipityDial}
                onChange={event => setSerendipityDial(Number(event.target.value))}
                aria-valuetext={`${serendipityDial}% outside your usual interests`}
                className="mt-2 w-full accent-amber-500 cursor-pointer"
              />
              <p className="mt-1 text-xs leading-relaxed text-slate-400">of the edition comes from outside your usual interests</p>
            </div>

            <button
              type="button"
              onClick={() => setShowDigestSettings(false)}
              className="w-full min-h-11 rounded-xl bg-amber-500 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Weekly Reading Review Modal */}
      <WeeklyReviewModal
        isOpen={showWeeklyReviewModal}
        onClose={() => setShowWeeklyReviewModal(false)}
        readingItems={weeklyHistory}
        onOpenArticle={(id) => {
          const item = digest.find(d => d.id === id) || savedArticles.find(s => s.id === id) || feedStreamArticles.find(f => f.id === id);
          if (item) setSelectedArticle(item);
        }}
        onOpenSettings={() => {
          setActiveTab('settings');
        }}
        showToast={showToast}
      />

    </div>
  );
}
