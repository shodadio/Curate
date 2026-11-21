// A feed body can carry a playable video — an <iframe> on a video host, a <video> element, an
// item enclosure of type video — and a channel feed can carry nothing but a link to the video's
// own page. All of it used to be thrown away: the body cleaner deletes players before the reader
// sees the text, which left at best a poster frame and a stray "Watch on Aeon" line where the
// video had been. This module finds that video once, while the feed is being parsed, and keeps
// one address the reader can actually play.
//
// "Playable" is deliberately narrow. A frame is a page inside our page, so only video hosts known
// to allow it are kept — YouTube and Vimeo, both through their no-tracking hosts — and every
// other <iframe> is ignored rather than framed. A file has to be a format a browser plays without
// a plugin. Every address has to be https, because a plain-http video is blocked as mixed content
// on the page that would show it, and a player that silently fails is worse than no player.

import { decodeEntities } from './markup';

export type VideoKind = 'file' | 'embed';

export interface VideoEmbed {
  // The address the reader hands to a <video> element or to an iframe.
  url: string;
  kind: VideoKind;
  // A still the publisher shipped with the video; most embeds have none of their own.
  poster?: string;
}

// The formats iOS Safari and the desktop browsers play without a plugin. HLS (.m3u8) is included
// because Safari plays it in a plain <video> element; elsewhere it degrades to a link.
const VIDEO_FILE = /\.(?:mp4|m4v|webm|ogv|ogg|mov|m3u8)(?:$)/i;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const SHORT_YOUTUBE_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

// YouTube ids are always eleven characters of this alphabet; anything else in the address is a
// playlist, a channel or a search, none of which is a video.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATH_IDS = new Set(['embed', 'shorts', 'live', 'v', 'e']);
const VIMEO_ID = /^\d{6,12}$/;
// An unlisted Vimeo video is playable only with the hash the publisher's own page carries.
const VIMEO_HASH = /^[0-9a-f]{6,16}$/i;

const attributeOf = (tag: string, name: string): string => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
};

// An address is only kept when it is one the page can load: absolute, and https.
function resolveHttpsUrl(raw: string, baseUrl = ''): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const resolved = new URL(trimmed, baseUrl || undefined);
    return resolved.protocol === 'https:' ? resolved.toString() : '';
  } catch {
    return '';
  }
}

function youtubeIdFrom(parsed: URL): string {
  const queryId = parsed.searchParams.get('v') || '';
  if (parsed.pathname.replace(/\/+$/, '') === '/watch' && YOUTUBE_ID.test(queryId)) return queryId;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && YOUTUBE_PATH_IDS.has(parts[0].toLowerCase()) && YOUTUBE_ID.test(parts[1])) {
    return parts[1];
  }
  return '';
}

function vimeoUrlFrom(parsed: URL): string {
  const parts = parsed.pathname.split('/').filter(Boolean);
  const candidate = parts[0]?.toLowerCase() === 'video' ? parts[1] : parts[0];
  if (!candidate || !VIMEO_ID.test(candidate)) return '';
  const hash = parsed.searchParams.get('h') || '';
  // `dnt=1` is Vimeo's own "do not track": the player still works and the reader is not profiled
  // before they press play.
  return `https://player.vimeo.com/video/${candidate}?dnt=1${VIMEO_HASH.test(hash) ? `&h=${hash}` : ''}`;
}

/**
 * The one playable address behind a URL, or null when the address is not a video we can show.
 * A watch link, a short link and an embed link all collapse to the embed address, so the same
 * video found twice in one feed is stored once.
 */
export function videoEmbedFromUrl(rawUrl: string, baseUrl = ''): VideoEmbed | null {
  const absolute = resolveHttpsUrl(rawUrl, baseUrl);
  if (!absolute) return null;
  let parsed: URL;
  try {
    parsed = new URL(absolute);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const id = youtubeIdFrom(parsed);
    return id ? { url: `https://www.youtube-nocookie.com/embed/${id}`, kind: 'embed' } : null;
  }
  if (SHORT_YOUTUBE_HOSTS.has(host)) {
    const id = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return YOUTUBE_ID.test(id) ? { url: `https://www.youtube-nocookie.com/embed/${id}`, kind: 'embed' } : null;
  }
  if (VIMEO_HOSTS.has(host)) {
    const url = vimeoUrlFrom(parsed);
    return url ? { url, kind: 'embed' } : null;
  }
  return VIDEO_FILE.test(parsed.pathname) ? { url: absolute, kind: 'file' } : null;
}

/**
 * The first playable video inside a piece of markup: a player the publisher embedded, or a video
 * file the page hands over directly. The poster a <video> element carries comes with it, so the
 * reader can draw a still instead of a black rectangle.
 */
export function findVideoEmbed(html: string, baseUrl = ''): VideoEmbed | null {
  if (!html) return null;

  // Atom feeds and some RSS items hand their HTML over escaped, so a player arrives as
  // "&lt;iframe …&gt;" and none of the tags below would match. Decoding the whole block first
  // also fixes the addresses at the same time: a player's "?a=1&amp;b=2" is one parameter, not
  // two, and an undecoded one would be passed on to the frame half-encoded.
  const markup = decodeEntities(html);

  // A framed player is the publisher's own choice of video, so it outranks a bare file.
  const iframeTags = /<iframe\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = iframeTags.exec(markup)) !== null) {
    // A player whose frame holds a placeholder until the reader scrolls to it names the real
    // address in a data attribute, so both are tried.
    for (const source of [attributeOf(match[0], 'src'), attributeOf(match[0], 'data-src')]) {
      const video = videoEmbedFromUrl(source, baseUrl);
      if (video && video.kind === 'embed') return video;
    }
  }

  // A <video> names its file in its own `src` or in a <source> child, and may carry a poster.
  const players = /<video\b[^>]*>([\s\S]*?)<\/video\s*>/gi;
  while ((match = players.exec(markup)) !== null) {
    const opening = match[0].slice(0, match[0].indexOf('>') + 1);
    const innerSource = match[1].match(/<source\b[^>]*>/i)?.[0] || '';
    const source = attributeOf(opening, 'src') || attributeOf(innerSource, 'src');
    const video = videoEmbedFromUrl(source, baseUrl);
    if (!video) continue;
    const poster = resolveHttpsUrl(attributeOf(opening, 'poster'), baseUrl);
    return poster ? { ...video, poster } : video;
  }

  // A feed that ships the <source> without the element around it still names a video.
  const sources = /<source\b[^>]*>/gi;
  while ((match = sources.exec(markup)) !== null) {
    const video = videoEmbedFromUrl(attributeOf(match[0], 'src'), baseUrl);
    if (video) return video;
  }

  return null;
}

/**
 * The page a reader lands on when the player cannot be shown inside the reader: the video's own
 * page on its host, which is what "watch this video" means outside an app.
 */
export function videoWatchUrl(video: VideoEmbed): string {
  if (video.kind === 'file') return video.url;
  const youtube = video.url.match(/^https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i);
  if (youtube) return `https://www.youtube.com/watch?v=${youtube[1]}`;
  const vimeo = video.url.match(/^https:\/\/player\.vimeo\.com\/video\/(\d+)/i);
  if (vimeo) return `https://vimeo.com/${vimeo[1]}`;
  return video.url;
}

/**
 * A stored or received video, checked before the screen trusts it. Anything written by an older
 * build, a damaged save or a hand-edited backup is read as no video at all.
 */
export function readVideoEmbed(value: unknown): VideoEmbed | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind: VideoKind | null = record.kind === 'embed' ? 'embed' : record.kind === 'file' ? 'file' : null;
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!kind || !/^https:\/\//i.test(url)) return null;
  // The embed host is fixed by the parser, so a stored link to anywhere else is not trusted.
  if (kind === 'embed' && !/^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/)/i.test(url)) {
    return null;
  }
  const poster = typeof record.poster === 'string' ? record.poster.trim() : '';
  return /^https:\/\//i.test(poster) ? { url, kind, poster } : { url, kind };
}
