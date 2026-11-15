import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

dotenv.config();

// Outbound fetch hardening: only public http(s) hosts, re-checked on every redirect hop
const MAX_REDIRECTS = 4;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

class BlockedUrlError extends Error {}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;              // "this" network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;               // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                         // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                // private 172.16/12
  if (a === 192 && b === 168) return true;                         // private 192.168/16
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;   // 192.0.0/24, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;            // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;             // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;              // TEST-NET-3
  if (a >= 224) return true;                                       // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === '::' || addr === '::1') return true;
  if (addr.startsWith('::ffff:')) {
    const mapped = addr.slice('::ffff:'.length);
    return net.isIPv4(mapped) ? isBlockedIpv4(mapped) : true;
  }
  const firstGroup = addr.split(':')[0];
  if (firstGroup.startsWith('fc') || firstGroup.startsWith('fd')) return true; // unique-local fc00::/7
  if (/^fe[89ab]/.test(firstGroup)) return true;                               // link-local fe80::/10
  if (firstGroup.startsWith('ff')) return true;                                // multicast
  return false;
}

function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true;
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new BlockedUrlError('URLs containing credentials are not supported');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new BlockedUrlError('URL is missing a host');
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new BlockedUrlError('Requests to local or internal hostnames are not allowed');
  }
  if (net.isIP(hostname) && isBlockedAddress(hostname)) {
    throw new BlockedUrlError('Requests to internal network addresses are not allowed');
  }
  return url;
}

// Filter DNS answers at connect time so a host cannot resolve to a public IP first and an internal one later
const guardedLookup = (
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void,
) => {
  const lookupOptions = typeof options === 'number' ? { family: options } : { ...options };
  dns.lookup(hostname, { ...lookupOptions, all: true } as dns.LookupAllOptions, (err, addresses) => {
    if (err) {
      callback(err);
      return;
    }
    const safe = addresses.filter(entry => !isBlockedAddress(entry.address));
    if (safe.length === 0) {
      callback(new BlockedUrlError('Host resolves to an internal network address'));
      return;
    }
    if (lookupOptions.all) {
      callback(null, safe);
      return;
    }
    callback(null, safe[0].address, safe[0].family);
  });
};

interface PageResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
}

function requestOnce(url: URL, timeoutMs: number): Promise<{ redirectTo?: string; page?: PageResponse }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const requester = isHttps ? https.request : http.request;
    const req = requester(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        lookup: guardedLookup as unknown as net.LookupFunction,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CuratorRSSInvestigator/1.0)',
          'Accept': 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
          'Accept-Encoding': 'identity'
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          try {
            resolve({ redirectTo: new URL(String(location), url).toString() });
          } catch {
            reject(new BlockedUrlError('Redirected to an invalid URL'));
          }
          return;
        }
        res.setEncoding('utf8');
        let text = '';
        res.on('data', (chunk: string) => {
          if (text.length < MAX_PAGE_BYTES) text += chunk;
        });
        res.on('end', () => {
          resolve({
            page: {
              ok: status >= 200 && status < 300,
              status,
              url: url.toString(),
              contentType: String(res.headers['content-type'] || ''),
              text
            }
          });
        });
        res.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      },
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function fetchPublicPage(targetUrl: string, timeoutMs = 4500): Promise<PageResponse> {
  let current = await assertPublicHttpUrl(targetUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(current, timeoutMs);
    if (result.page) return result.page;
    current = await assertPublicHttpUrl(result.redirectTo as string);
  }
  throw new BlockedUrlError('Too many redirects');
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const PORT = process.env.PORT || 3000;

  // Initialize Gemini SDK if API key is present
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // API Routes
  // OPML Parser endpoint
  app.post('/api/parse-opml', (req, res) => {
    try {
      const { opmlText } = req.body;
      if (!opmlText || typeof opmlText !== 'string' || !opmlText.trim()) {
        return res.status(400).json({ error: 'No OPML content provided' });
      }

      const decodeXml = (str: string) =>
        str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'");

      const getAttr = (tag: string, attr: string): string | undefined => {
        const regex = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
        const match = tag.match(regex);
        const val = match?.[1] ?? match?.[2];
        return val !== undefined ? decodeXml(val.trim()) : undefined;
      };

      const sources: Array<{
        id: string;
        title: string;
        feedUrl: string;
        folder: string;
        status: 'active' | 'failing';
        failingReason?: string;
      }> = [];
      const failures: Array<{ title: string; reason: string }> = [];
      const seenUrls = new Set<string>();

      // Tokenize all <outline ...> opening/self-closing tags and </outline> closing tags
      const tagRegex = /<\/outline\s*>|<outline\b[^>]*\/?>/gi;
      const folderStack: string[] = [];
      let match: RegExpExecArray | null;
      let foundAnyOutline = false;

      while ((match = tagRegex.exec(opmlText)) !== null) {
        const tag = match[0];
        foundAnyOutline = true;

        if (/^<\/outline/i.test(tag)) {
          if (folderStack.length > 0) {
            folderStack.pop();
          }
          continue;
        }

        const isSelfClosing = /\/>$/.test(tag);
        const xmlUrl = getAttr(tag, 'xmlUrl');
        const title = getAttr(tag, 'title') || getAttr(tag, 'text') || '';
        const categoryAttr = getAttr(tag, 'category');
        const typeAttr = getAttr(tag, 'type');

        if (xmlUrl !== undefined) {
          const cleanTitle = title || xmlUrl;
          const folder =
            folderStack.length > 0
              ? folderStack[folderStack.length - 1]
              : categoryAttr || 'Uncategorized';

          if (!xmlUrl) {
            failures.push({ title: cleanTitle || 'Unnamed feed', reason: 'Missing feed URL' });
            continue;
          }

          const normalizedUrl = xmlUrl.toLowerCase();
          if (seenUrls.has(normalizedUrl)) {
            continue; // deduplicate identical feeds silently
          }
          seenUrls.add(normalizedUrl);

          let isValidUrl = false;
          try {
            const parsed = new URL(xmlUrl);
            isValidUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
          } catch {
            isValidUrl = false;
          }

          if (!isValidUrl) {
            sources.push({
              id: 'src_' + Math.random().toString(36).substring(2, 9),
              title: cleanTitle,
              feedUrl: xmlUrl,
              folder,
              status: 'failing',
              failingReason: 'Invalid feed URL format',
            });
            failures.push({ title: cleanTitle, reason: 'Invalid feed URL format' });
          } else {
            sources.push({
              id: 'src_' + Math.random().toString(36).substring(2, 9),
              title: cleanTitle,
              feedUrl: xmlUrl,
              folder,
              status: 'active',
            });
          }
        } else if (!isSelfClosing) {
          // Container folder outline (e.g. <outline text="Economics" title="Economics">)
          const isRootWrapper =
            !title ||
            title.toLowerCase() === 'subscriptions' ||
            title.toLowerCase() === 'feeds';
          folderStack.push(
            isRootWrapper
              ? folderStack[folderStack.length - 1] || 'Uncategorized'
              : title
          );
        } else if (typeAttr && typeAttr.toLowerCase() === 'rss') {
          // Self-closing RSS outline without xmlUrl
          failures.push({ title: title || 'Unnamed feed', reason: 'Missing xmlUrl attribute' });
        }
      }

      if (!foundAnyOutline || (sources.length === 0 && failures.length === 0)) {
        return res.status(400).json({
          error: 'No subscription outlines found. Please upload a valid .opml or .xml subscription file.',
        });
      }

      const successCount = sources.filter(s => s.status === 'active').length;
      const failCount = sources.filter(s => s.status === 'failing').length;

      res.json({
        success: true,
        totalImported: sources.length,
        successCount,
        failCount,
        failures,
        sources,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to parse OPML' });
    }
  });

  // In-memory feed cache with 5-minute TTL to keep requests snappy
  interface FeedCacheEntry {
    timestamp: number;
    items: any[];
  }
  const feedCache = new Map<string, FeedCacheEntry>();
  const FEED_CACHE_TTL = 5 * 60 * 1000;

  const DEFAULT_FEEDS = [
    { title: 'Marginal Revolution', feedUrl: 'https://marginalrevolution.com/feed', folder: 'Economics' },
    { title: 'Dan Luu', feedUrl: 'https://danluu.com/atom.xml', folder: 'Tech & Engineering' },
    { title: 'Simon Willison', feedUrl: 'https://simonwillison.net/atom/entries/', folder: 'Software & AI' },
    { title: 'Ars Technica', feedUrl: 'https://feeds.arstechnica.com/arstechnica/index', folder: 'Tech & Policy' },
    { title: 'Stratechery', feedUrl: 'https://stratechery.com/feed/', folder: 'Tech & Strategy' },
    { title: 'A List Apart', feedUrl: 'https://alistapart.com/main/feed/', folder: 'Design & Craft' },
    { title: 'Aeon Magazine', feedUrl: 'https://aeon.co/feed.rss', folder: 'Philosophy & Culture' },
    { title: 'Rest of World', feedUrl: 'https://restofworld.org/feed/latest', folder: 'Global Tech' }
  ];

  const cleanHtml = (str: string): string => {
    if (!str) return '';
    return str
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8217;|&#8216;/g, "'")
      .replace(/&#8220;|&#8221;/g, '"')
      .replace(/&#8212;/g, '—')
      .replace(/&#8211;/g, '–')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const htmlToReadableText = (html: string): string => {
    if (!html) return '';
    return html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#8217;|&#8216;/g, "'")
      .replace(/&#8220;|&#8221;/g, '"')
      .replace(/&#8212;/g, '—')
      .replace(/&#8211;/g, '–')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const formatPublishDate = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr || 'Recently';
      const now = Date.now();
      const diffMs = now - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 60 && diffMins >= 0) {
        return `Today · ${Math.max(1, diffMins)}m ago`;
      }
      if (diffHours < 24 && diffHours >= 0) {
        return `Today · ${diffHours}h ago`;
      }
      if (diffDays === 1) {
        return 'Yesterday';
      }
      if (diffDays < 7 && diffDays > 1) {
        return `${diffDays} days ago`;
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const parseFeedItems = (xml: string, sourceTitle: string, folder: string, baseUrl: string): any[] => {
    const items: any[] = [];
    const regex = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
    let m: RegExpExecArray | null;

    while ((m = regex.exec(xml)) !== null && items.length < 15) {
      const block = m[1];
      const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = cleanHtml(titleMatch ? titleMatch[1] : 'Untitled');
      if (!title || title.length < 2) continue;

      let link = '';
      const linkHrefMatch = block.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i);
      if (linkHrefMatch && linkHrefMatch[1]) {
        link = linkHrefMatch[1].trim();
      } else {
        const linkTagMatch = block.match(/<link[^>]*>([sS]*?)<\/link>/i);
        if (linkTagMatch && linkTagMatch[1]) {
          link = cleanHtml(linkTagMatch[1]).trim();
        }
      }
      if (!link) {
        const guidMatch = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || block.match(/<id[^>]*>([\s\S]*?)<\/id>/i);
        if (guidMatch && guidMatch[1] && guidMatch[1].startsWith('http')) {
          link = cleanHtml(guidMatch[1]).trim();
        }
      }
      if (!link && baseUrl) link = baseUrl;
      if (link.startsWith('/') && baseUrl) {
        try { link = new URL(link, baseUrl).toString(); } catch { /* ignore */ }
      }

      const dateMatch = block.match(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/i);
      const rawDate = dateMatch ? cleanHtml(dateMatch[1]) : '';
      const publishedAt = formatPublishDate(rawDate);

      const contentMatch = block.match(/<(?:content:encoded|content)[^>]*>([\s\S]*?)<\/(?:content:encoded|content)>/i);
      const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
      const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

      const fullRaw = contentMatch ? contentMatch[1] : (descMatch ? descMatch[1] : (summaryMatch ? summaryMatch[1] : ''));
      const cleanFull = htmlToReadableText(fullRaw);

      const summaryRaw = summaryMatch ? summaryMatch[1] : (descMatch ? descMatch[1] : fullRaw);
      let summary = cleanHtml(summaryRaw);
      if (summary.length > 280) {
        summary = summary.slice(0, 277).replace(/\s+\S*$/, '') + '...';
      }
      if (!summary) {
        summary = title;
      }

      let bannerImage: string | undefined;
      const mediaMatch = block.match(/<media:content\b[^>]*url\s*=\s*["']([^"']+)["'][^>]*>/i) ||
                         block.match(/<enclosure\b[^>]*url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image\/[^"']+["'][^>]*>/i) ||
                         block.match(/<enclosure\b[^>]*type\s*=\s*["']image\/[^"']+["'][^>]*url\s*=\s*["']([^"']+)["'][^>]*>/i);
      if (mediaMatch && mediaMatch[1]) {
        bannerImage = mediaMatch[1];
      } else {
        const imgMatch = fullRaw.match(/<img\b[^>]*src\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/i);
        if (imgMatch && imgMatch[1] && !imgMatch[1].includes('feedburner') && !imgMatch[1].includes('tracking') && !imgMatch[1].includes('spacer')) {
          bannerImage = imgMatch[1];
        }
      }

      const words = cleanFull.split(/\s+/).filter(Boolean).length;
      const minutes = Math.max(2, Math.round(words / 200));
      const readTime = `${minutes} min read`;

      const idHash = Buffer.from(link || title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
      const id = `live_${idHash}`;

      items.push({
        id,
        source: sourceTitle,
        folder: folder || 'General',
        title,
        summary,
        readTime,
        url: link,
        fullText: cleanFull.length > 120 ? cleanFull : (summary + '\n\n' + 'Read the complete article directly at: ' + link),
        publishedAt,
        bannerImage,
        isOutOfBubble: false,
        why: `From your ${sourceTitle} subscription.`
      });
    }
    return items;
  };

  const fetchFeedArticles = async (feedUrl: string, sourceTitle: string, folder: string): Promise<any[]> => {
    if (!feedUrl) return [];
    const cached = feedCache.get(feedUrl);
    if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL) {
      return cached.items;
    }
    try {
      const page = await fetchPublicPage(feedUrl, 7000);
      if (page && page.ok && page.text) {
        const parsed = parseFeedItems(page.text, sourceTitle, folder, feedUrl);
        if (parsed.length > 0) {
          feedCache.set(feedUrl, { timestamp: Date.now(), items: parsed });
          return parsed;
        }
      }
    } catch (err: any) {
      console.warn(`[FeedFetch] Failed to fetch feed for "${sourceTitle}" (${feedUrl}):`, err.message);
    }
    return [];
  };

  // Curate daily digest from live feeds using Gemini, with a deterministic fallback
  app.post('/api/curate', async (req, res) => {
    try {
      const { sources: clientSources, signals, readingStats, serendipityDial = 30, itemCount = 6, apiKey: clientApiKey } = req.body;

      const activeSources = Array.isArray(clientSources) && clientSources.length > 0
        ? clientSources.filter((s: any) => s.status !== 'failing')
        : DEFAULT_FEEDS;

      // 1. Fetch live articles from candidate sources in parallel
      const feedResults = await Promise.allSettled(
        activeSources.slice(0, 10).map((s: any) => fetchFeedArticles(s.feedUrl, s.title, s.folder))
      );

      let candidatePool: any[] = [];
      for (const r of feedResults) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          candidatePool.push(...r.value);
        }
      }

      // If pool is sparse, fetch from default verified feeds as supplement
      if (candidatePool.length < 4) {
        const defResults = await Promise.allSettled(
          DEFAULT_FEEDS.map(f => fetchFeedArticles(f.feedUrl, f.title, f.folder))
        );
        for (const r of defResults) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            candidatePool.push(...r.value);
          }
        }
      }

      // Deduplicate candidates by url or title
      const seenKeys = new Set<string>();
      candidatePool = candidatePool.filter(item => {
        if (!item || !item.title) return false;
        const key = item.url || item.id || item.title;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      const moreTopics: string[] = Array.isArray(signals?.moreTopics)
        ? signals.moreTopics
        : Array.isArray(signals?.more) ? signals.more : [];
      const lessTopics: string[] = Array.isArray(signals?.lessTopics)
        ? signals.lessTopics
        : Array.isArray(signals?.less) ? signals.less : [];
      const moreIds: string[] = Array.isArray(signals?.moreIds) ? signals.moreIds : [];
      const lessIds: string[] = Array.isArray(signals?.lessIds) ? signals.lessIds : [];

      // 2. Curate with Gemini when the candidate pool is ready
      if (candidatePool.length >= 4) {
        const candidatesForAi = candidatePool.slice(0, 30).map((item, idx) => ({
          idx,
          title: item.title,
          source: item.source,
          folder: item.folder,
          summary: item.summary,
          readTime: item.readTime
        }));

        const prompt = `You are a sophisticated personal reading editor. Your task is to curate a daily reading digest of exactly ${itemCount} items by selecting the best articles from the live candidate pool below based on the user's signals and serendipity setting (${serendipityDial}%).

Live Candidate Articles:
${JSON.stringify(candidatesForAi)}

User Reading Preferences:
- Prioritized Topics (MORE): ${JSON.stringify(moreTopics)}
- De-emphasized Topics (LESS): ${JSON.stringify(lessTopics)}
- Articles thumbs-up: ${JSON.stringify(moreIds)}
- Articles thumbs-down: ${JSON.stringify(lessIds)}
Serendipity Dial: ${serendipityDial}% (0% = stay close to established interests; 100% = stretch into unfamiliar intellectual territories).

CURATION RULES:
1. Select exactly ${itemCount} unique items from the candidate pool using their "idx".
2. At least 1 (or 2 if serendipity >= 40) should be an "isOutOfBubble": true stretch item from a folder different from the user's top interests.
3. For each selected item, write a 1-sentence editorial "why" rationale explaining why this piece was selected (e.g. "Selected for your reading interest in Economics", "A thoughtful design retrospective", "Deliberate stretch: outside your usual tech routine").
4. Return ONLY a JSON array of objects with keys: "idx" (number), "why" (string), "isOutOfBubble" (boolean).`;

        let aiSelections: Array<{ idx: number; why: string; isOutOfBubble: boolean }> | null = null;

        const activeAi = clientApiKey?.trim()
          ? new GoogleGenAI({ apiKey: clientApiKey.trim(), httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
          : ai;

        if (activeAi) {
          try {
            const response = await activeAi.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: prompt,
              config: {
                responseMimeType: 'application/json'
              }
            });
            if (response.text) {
              const parsed = JSON.parse(response.text);
              const list = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.selections || parsed?.digest);
              if (Array.isArray(list) && list.length > 0) aiSelections = list;
            }
          } catch (err: any) {
            console.warn('[Curator] Gemini curation failed:', err.message);
          }
        }

        if (aiSelections && aiSelections.length > 0) {
          const chosenArticles: any[] = [];
          const usedIdx = new Set<number>();
          for (const sel of aiSelections) {
            const candidate = candidatePool[sel.idx];
            if (candidate && !usedIdx.has(sel.idx)) {
              usedIdx.add(sel.idx);
              chosenArticles.push({
                ...candidate,
                why: sel.why || candidate.why,
                isOutOfBubble: Boolean(sel.isOutOfBubble)
              });
            }
          }

          if (chosenArticles.length >= Math.min(itemCount, candidatePool.length)) {
            return res.json({ digest: chosenArticles.slice(0, itemCount), generatedByAI: true });
          }
        }
      }

      // 3. Deterministic signal-aware curation over the live candidate pool
      const matchesTopicSignal = (item: any, topicList: string[]) =>
        topicList.some(sig => {
          const s = sig.toLowerCase().trim();
          if (!s) return false;
          return (
            (item.folder && item.folder.toLowerCase().includes(s)) ||
            (item.title && item.title.toLowerCase().includes(s)) ||
            (item.summary && item.summary.toLowerCase().includes(s))
          );
        });

      const scored = candidatePool
        .filter(item => !lessIds.includes(item.id) && !matchesTopicSignal(item, lessTopics))
        .map((item, idx) => {
          let score = 100 - idx;
          let why = `Top dispatch from ${item.source}.`;
          let isOutOfBubble = false;

          if (moreIds.includes(item.id) || matchesTopicSignal(item, moreTopics)) {
            score += 40;
            why = `Selected for your reading interest in ${item.folder}.`;
          }
          if (readingStats && readingStats[item.id]?.finished) {
            score += 5;
          }

          if (idx % 3 === 2) {
            isOutOfBubble = true;
            why = 'Deliberate stretch: outside your usual reading routine.';
          }

          return { ...item, why, isOutOfBubble, _score: score };
        });

      const inBubble = scored
        .filter(i => !i.isOutOfBubble)
        .sort((a, b) => b._score - a._score);

      const outBubble = scored
        .filter(i => i.isOutOfBubble)
        .sort((a, b) => b._score - a._score);

      const stretchTarget = serendipityDial >= 50 ? Math.min(2, outBubble.length) : (serendipityDial >= 20 ? Math.min(1, outBubble.length) : 0);
      const regularTarget = Math.max(0, itemCount - stretchTarget);

      const selected = [
        ...inBubble.slice(0, regularTarget),
        ...outBubble.slice(0, stretchTarget)
      ].map(({ _score, ...rest }) => rest);

      res.json({ digest: selected.slice(0, itemCount), generatedByAI: false });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate digest' });
    }
  });

  // Comprehensive multi-source live feed stream endpoint
  app.post('/api/feed-stream', async (req, res) => {
    try {
      const { sourceTitle, sources: clientSources } = req.body;
      const allSources = Array.isArray(clientSources) && clientSources.length > 0
        ? clientSources
        : DEFAULT_FEEDS;

      let targetFeeds: Array<{ title: string; feedUrl: string; folder: string }> = [];

      if (sourceTitle && sourceTitle.trim() && sourceTitle !== 'all') {
        const queryNorm = sourceTitle.trim().toLowerCase();
        const matched = allSources.filter((s: any) =>
          String(s.title || '').toLowerCase() === queryNorm ||
          String(s.title || '').toLowerCase().includes(queryNorm) ||
          queryNorm.includes(String(s.title || '').toLowerCase()) ||
          String(s.id || '') === sourceTitle
        );
        if (matched.length > 0) {
          targetFeeds = matched;
        } else {
          const defMatch = DEFAULT_FEEDS.filter(s =>
            s.title.toLowerCase().includes(queryNorm) || queryNorm.includes(s.title.toLowerCase())
          );
          targetFeeds = defMatch.length > 0 ? defMatch : [{ title: sourceTitle, feedUrl: '', folder: 'Custom Feed' }];
        }
      } else {
        targetFeeds = allSources.filter((s: any) => s.status !== 'failing').slice(0, 10);
      }

      const results = await Promise.allSettled(
        targetFeeds.map(f => fetchFeedArticles(f.feedUrl, f.title, f.folder))
      );

      let articles: any[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
          articles.push(...r.value);
        }
      }

      if (articles.length === 0 && targetFeeds !== DEFAULT_FEEDS) {
        const defResults = await Promise.allSettled(
          DEFAULT_FEEDS.slice(0, 4).map(f => fetchFeedArticles(f.feedUrl, f.title, f.folder))
        );
        for (const r of defResults) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            articles.push(...r.value);
          }
        }
      }

      res.json({
        success: true,
        source: sourceTitle || 'all',
        total: articles.length,
        articles
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to retrieve feed stream' });
    }
  });

  // Helper utilities for RSS discovery and HTML-to-RSS investigation
  const fetchPageWithTimeout = (targetUrl: string, timeoutMs = 4500) => fetchPublicPage(targetUrl, timeoutMs);

  const detectFeedFormat = (text: string, contentType: string): 'RSS 2.0' | 'Atom' | 'JSON Feed' | null => {
    const lowerCt = contentType.toLowerCase();
    const head = text.slice(0, 2000).toLowerCase();
    if (lowerCt.includes('feed+json') || (head.includes('https://jsonfeed.org/version') && head.includes('"items"'))) {
      return 'JSON Feed';
    }
    if (head.includes('<feed') && (head.includes('http://www.w3.org/2005/atom') || head.includes('<entry'))) {
      return 'Atom';
    }
    if (head.includes('<rss') || head.includes('<rdf:rdf') || (head.includes('<channel>') && head.includes('<item>'))) {
      return 'RSS 2.0';
    }
    return null;
  };

  const extractFeedTitles = (text: string, format: 'RSS 2.0' | 'Atom' | 'JSON Feed'): string[] => {
    try {
      if (format === 'JSON Feed') {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.items)) {
          return parsed.items
            .slice(0, 3)
            .map((it: any) => String(it.title || it.content_text || '').trim())
            .filter(Boolean);
        }
        return [];
      }
      const tag = format === 'Atom' ? 'entry' : 'item';
      const itemRegex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      const titles: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = itemRegex.exec(text)) !== null && titles.length < 3) {
        const titleMatch = m[1].match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        if (titleMatch?.[1]) {
          const clean = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          if (clean) titles.push(clean);
        }
      }
      return titles;
    } catch {
      return [];
    }
  };

  const extractAlternateFeedsFromHtml = (html: string, baseUrl: string): string[] => {
    const found: string[] = [];
    const linkRegex = /<link\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(html)) !== null) {
      const tag = m[0];
      const rel = tag.match(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const relVal = (rel?.[1] ?? rel?.[2] ?? '').toLowerCase();
      if (!relVal.includes('alternate')) continue;

      const type = tag.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const typeVal = (type?.[1] ?? type?.[2] ?? '').toLowerCase();
      if (
        !typeVal.includes('rss') &&
        !typeVal.includes('atom') &&
        !typeVal.includes('feed+json') &&
        !typeVal.includes('xml')
      ) {
        continue;
      }

      const href = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const hrefVal = (href?.[1] ?? href?.[2] ?? '').trim();
      if (!hrefVal) continue;
      try {
        const resolved = new URL(hrefVal, baseUrl).toString();
        if (!found.includes(resolved)) found.push(resolved);
      } catch {
        // ignore invalid href
      }
    }
    return found;
  };

  const extractHtmlArticleCandidates = (html: string, baseUrl: string): Array<{ title: string; url: string }> => {
    const results: Array<{ title: string; url: string }> = [];
    const seenUrls = new Set<string>();
    const skipPattern = /\/(login|signin|signup|register|privacy|terms|cookie|about|contact|subscribe|pricing|search|tag|category|author)\b/i;

    // Prefer links inside <article> or heading tags (<h1>-<h4>)
    const blockRegex = /<(?:article|h1|h2|h3|h4)\b[^>]*>[\s\S]*?<\/(?:article|h1|h2|h3|h4)>/gi;
    const anchorRegex = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

    const collectFromHtmlChunk = (chunk: string) => {
      let aMatch: RegExpExecArray | null;
      anchorRegex.lastIndex = 0;
      while ((aMatch = anchorRegex.exec(chunk)) !== null && results.length < 10) {
        const rawHref = (aMatch[1] ?? aMatch[2] ?? '').trim();
        const rawText = aMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:')) continue;
        if (rawText.length < 18 || rawText.length > 180) continue;

        try {
          const resolved = new URL(rawHref, baseUrl).toString();
          if (skipPattern.test(resolved)) continue;
          if (resolved === baseUrl || resolved === baseUrl + '/') continue;
          if (seenUrls.has(resolved)) continue;
          seenUrls.add(resolved);
          results.push({ title: rawText, url: resolved });
        } catch {
          // ignore
        }
      }
    };

    let bMatch: RegExpExecArray | null;
    while ((bMatch = blockRegex.exec(html)) !== null && results.length < 10) {
      collectFromHtmlChunk(bMatch[0]);
    }

    if (results.length < 2) {
      collectFromHtmlChunk(html);
    }

    return results;
  };

  const investigateSourceForRss = async (candidate: {
    title: string;
    siteUrl: string;
    guessedFeedUrl?: string;
    folder?: string;
    summary?: string;
  }) => {
    const baseOutput = {
      title: candidate.title,
      siteUrl: candidate.siteUrl,
      folder: candidate.folder || 'Discovered',
      summary: candidate.summary || '',
    };

    let normalizedSiteUrl = candidate.siteUrl;
    try {
      const u = new URL(normalizedSiteUrl);
      normalizedSiteUrl = u.toString();
    } catch {
      return {
        ...baseOutput,
        rssStatus: 'unavailable' as const,
        canGenerateRss: false,
        feedUrl: null as string | null,
        feedFormat: null as string | null,
        sampleTitles: [] as string[],
        investigationNote: 'Invalid website URL returned from search.',
      };
    }

    const probeFeedUrl = async (urlToTest: string) => {
      try {
        const res = await fetchPageWithTimeout(urlToTest, 3500);
        if (!res.ok) return null;
        const format = detectFeedFormat(res.text, res.contentType);
        if (!format) return null;
        return {
          feedUrl: res.url,
          format,
          sampleTitles: extractFeedTitles(res.text, format),
        };
      } catch {
        return null;
      }
    };

    // 1. Probe guessedFeedUrl if provided
    if (candidate.guessedFeedUrl) {
      const direct = await probeFeedUrl(candidate.guessedFeedUrl);
      if (direct) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: direct.feedUrl,
          feedFormat: direct.format,
          sampleTitles: direct.sampleTitles,
          investigationNote: `Verified native ${direct.format} feed.`,
        };
      }
    }

    // 2. Fetch site HTML to look for <link rel="alternate"> or inspect HTML structure
    let htmlRes: Awaited<ReturnType<typeof fetchPageWithTimeout>> | null = null;
    try {
      htmlRes = await fetchPageWithTimeout(normalizedSiteUrl, 4500);
      // In case siteUrl itself IS already a feed
      const directFormat = detectFeedFormat(htmlRes.text, htmlRes.contentType);
      if (htmlRes.ok && directFormat) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: htmlRes.url,
          feedFormat: directFormat,
          sampleTitles: extractFeedTitles(htmlRes.text, directFormat),
          investigationNote: `Verified native ${directFormat} feed.`,
        };
      }
    } catch {
      htmlRes = null;
    }

    if (htmlRes && htmlRes.ok) {
      const alternateFeeds = extractAlternateFeedsFromHtml(htmlRes.text, htmlRes.url);
      for (const altUrl of alternateFeeds.slice(0, 2)) {
        const verified = await probeFeedUrl(altUrl);
        if (verified) {
          return {
            ...baseOutput,
            rssStatus: 'native' as const,
            canGenerateRss: false,
            feedUrl: verified.feedUrl,
            feedFormat: verified.format,
            sampleTitles: verified.sampleTitles,
            investigationNote: `Native ${verified.format} feed discovered in page metadata.`,
          };
        }
      }
    }

    // 3. Probe common feed endpoints at origin
    try {
      const origin = new URL(normalizedSiteUrl).origin;
      const commonPaths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'];
      const probeResults = await Promise.all(commonPaths.map(p => probeFeedUrl(origin + p)));
      const foundStandard = probeResults.find(Boolean);
      if (foundStandard) {
        return {
          ...baseOutput,
          rssStatus: 'native' as const,
          canGenerateRss: false,
          feedUrl: foundStandard.feedUrl,
          feedFormat: foundStandard.format,
          sampleTitles: foundStandard.sampleTitles,
          investigationNote: `Native ${foundStandard.format} feed found at standard endpoint.`,
        };
      }
    } catch {
      // ignore
    }

    // 4. Evaluate whether an RSS feed can be generated from the HTML page
    if (!htmlRes) {
      return {
        ...baseOutput,
        rssStatus: 'unreachable' as const,
        canGenerateRss: false,
        feedUrl: null,
        feedFormat: null,
        sampleTitles: [],
        investigationNote: 'Site timed out or could not be reached to check for RSS generation.',
      };
    }

    const bodyLower = htmlRes.text.toLowerCase();
    const isBlocked =
      htmlRes.status === 401 ||
      htmlRes.status === 403 ||
      htmlRes.status === 429 ||
      bodyLower.includes('cf-browser-verification') ||
      bodyLower.includes('attention required! | cloudflare') ||
      bodyLower.includes('just a moment...');

    if (isBlocked) {
      return {
        ...baseOutput,
        rssStatus: 'blocked' as const,
        canGenerateRss: false,
        feedUrl: null,
        feedFormat: null,
        sampleTitles: [],
        investigationNote: `No native feed found; site blocks automated HTML reading (HTTP ${htmlRes.status}), so an RSS feed cannot be generated.`,
      };
    }

    const articleCandidates = extractHtmlArticleCandidates(htmlRes.text, htmlRes.url);
    if (articleCandidates.length >= 2) {
      const generatedFeedUrl = `/api/generated-feed?url=${encodeURIComponent(htmlRes.url)}&title=${encodeURIComponent(candidate.title)}`;
      return {
        ...baseOutput,
        rssStatus: 'generatable' as const,
        canGenerateRss: true,
        feedUrl: generatedFeedUrl,
        feedFormat: 'Generated RSS 2.0',
        sampleTitles: articleCandidates.slice(0, 3).map(a => a.title),
        investigationNote: `No native RSS found, but ${articleCandidates.length} structured HTML articles are accessible — an RSS feed can be generated.`,
      };
    }

    const isSpaShell =
      (bodyLower.includes('<div id="root"></div>') || bodyLower.includes('<div id="app"></div>') || bodyLower.includes('__next_data__')) &&
      articleCandidates.length === 0;

    return {
      ...baseOutput,
      rssStatus: 'unavailable' as const,
      canGenerateRss: false,
      feedUrl: null,
      feedFormat: null,
      sampleTitles: [],
      investigationNote: isSpaShell
        ? 'No native feed found; page requires client-side JavaScript rendering, so an HTML-to-RSS feed cannot be generated.'
        : 'No native feed found and no structured article links were detected on this page.',
    };
  };

  // Google Search Grounding + RSS Feed Investigation endpoint
  app.post('/api/discover-sources', async (req, res) => {
    try {
      const { query, apiKey: clientApiKey } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'Search terms are required.' });
      }

      const trimmedClientKey = typeof clientApiKey === 'string' ? clientApiKey.trim() : '';

      const discoveryAi = trimmedClientKey
        ? new GoogleGenAI({ apiKey: trimmedClientKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
        : ai;

      const prompt = `Use Google Search to find 5 to 6 high-quality independent publications, blogs, newsletters, or editorial websites relevant to this search topic: "${query.trim()}".

Focus on thoughtful writing and recurring publications (not social media profiles, shopping pages, or encyclopedias).

Return a JSON array (wrapped in \`\`\`json ... \`\`\`) where each object has:
- "title": publication or blog name
- "siteUrl": full homepage or section URL (https://...)
- "guessedFeedUrl": likely RSS or Atom feed URL if known, otherwise empty string ""
- "folder": short 1-2 word topic folder name (e.g. "Economics", "History", "AI & Tech")
- "summary": one concise plain-English sentence describing what the publication writes about.`;

      let rawText = '';
      let groundingChunks: Array<{ title: string; uri: string }> = [];
      let webSearchQueries: string[] = [];
      let parsedCandidates: Array<{
        title: string;
        siteUrl: string;
        guessedFeedUrl?: string;
        folder?: string;
        summary?: string;
      }> = [];

      const isValidCandidate = (item: any) =>
        Boolean(item && typeof item.title === 'string' && typeof item.siteUrl === 'string');

      if (discoveryAi) {
        try {
          const response = await discoveryAi.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });

          rawText = response.text || '';
          const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
          groundingChunks = (groundingMetadata?.groundingChunks || [])
            .map((c: any) => ({
              title: c?.web?.title || '',
              uri: c?.web?.uri || '',
            }))
            .filter((c: { title: string; uri: string }) => Boolean(c.uri));

          webSearchQueries = groundingMetadata?.webSearchQueries || [];

          try {
            const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
            const jsonCandidate = fencedMatch ? fencedMatch[1] : rawText;
            const arrayMatch = jsonCandidate.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              const parsed = JSON.parse(arrayMatch[0]);
              if (Array.isArray(parsed)) {
                parsedCandidates = parsed.filter(
                  (item: any) => item && typeof item.title === 'string' && typeof item.siteUrl === 'string'
                );
              }
            }
          } catch {
            // Fallback to grounding chunks if model output wasn't cleanly structured JSON
          }

          if (parsedCandidates.length === 0 && groundingChunks.length > 0) {
            const seenOrigins = new Set<string>();
            for (const chunk of groundingChunks) {
              try {
                const origin = new URL(chunk.uri).origin;
                if (seenOrigins.has(origin)) continue;
                seenOrigins.add(origin);
                parsedCandidates.push({
                  title: chunk.title || origin.replace(/^https?:\/\/(www\.)?/, ''),
                  siteUrl: chunk.uri,
                  folder: query.trim().slice(0, 24),
                  summary: 'Discovered via Google Search grounding.',
                });
                if (parsedCandidates.length >= 6) break;
              } catch {
                // ignore
              }
            }
          }
        } catch {
          console.warn('[Curator] Search grounding AI call unavailable, using curated directory.');
        }
      }

      // If AI search was unavailable or yielded no results, use curated directory
      if (parsedCandidates.length === 0) {
        const directory = [
          { title: 'Stratechery by Ben Thompson', siteUrl: 'https://stratechery.com', folder: 'Tech & Strategy', summary: 'On the business, strategy, and impact of technology.' },
          { title: 'Marginal Revolution', siteUrl: 'https://marginalrevolution.com', folder: 'Economics', summary: 'Small steps toward a much better world by Tyler Cowen and Alex Tabarrok.' },
          { title: 'Dan Luu', siteUrl: 'https://danluu.com', folder: 'Engineering', summary: 'Rigorous engineering retrospective essays and systems analysis.' },
          { title: 'The Anthropic Stack', siteUrl: 'https://anthropic.com', folder: 'Tech & AI', summary: 'Research on frontier models, steering, and constitutional intelligence.' },
          { title: 'Rest of World', siteUrl: 'https://restofworld.org', folder: 'Global Tech', summary: 'Reporting on the impact of technology outside the Western bubble.' },
          { title: 'Long Now Foundation', siteUrl: 'https://longnow.org', folder: 'Philosophy', summary: 'Fostering long-term thinking and deep responsibility for the next 10,000 years.' },
          { title: 'Prospect Magazine', siteUrl: 'https://prospectmagazine.co.uk', folder: 'Culture & Ideas', summary: 'In-depth essays on politics, economics, and contemporary philosophy.' },
          { title: 'A List Apart', siteUrl: 'https://alistapart.com', folder: 'Design & Code', summary: 'Explores the design, development, and meaning of web content.' }
        ];
        const q = query.trim().toLowerCase();
        const matches = directory.filter(d => 
          d.title.toLowerCase().includes(q) || 
          d.folder.toLowerCase().includes(q) || 
          d.summary.toLowerCase().includes(q)
        );
        parsedCandidates = matches.length > 0 ? matches : directory.slice(0, 5);
      }

      // Deduplicate by origin and cap at 6 candidates for snappy parallel investigation
      const uniqueCandidates: typeof parsedCandidates = [];
      const seenDomains = new Set<string>();
      for (const cand of parsedCandidates) {
        try {
          const host = new URL(cand.siteUrl).hostname.replace(/^www\./, '').toLowerCase();
          if (seenDomains.has(host)) continue;
          seenDomains.add(host);
          uniqueCandidates.push(cand);
          if (uniqueCandidates.length >= 6) break;
        } catch {
          // skip malformed urls
        }
      }

      const investigated = await Promise.all(
        uniqueCandidates.map(cand => investigateSourceForRss(cand))
      );

      res.json({
        query: query.trim(),
        webSearchQueries,
        groundingLinks: groundingChunks.slice(0, 8),
        results: investigated,
      });
    } catch (err: any) {
      console.warn('Discover sources notice:', err?.message || err);
      res.status(500).json({ error: err?.message || 'Failed to search for sources.' });
    }
  });

  // Generated HTML-to-RSS 2.0 endpoint for sites without native RSS
  app.get('/api/generated-feed', async (req, res) => {
    try {
      const targetUrl = String(req.query.url || '').trim();
      const feedTitle = String(req.query.title || 'Generated Curator Feed').trim();
      if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
      }

      const page = await fetchPageWithTimeout(targetUrl, 5000);
      if (!page.ok) {
        return res.status(502).send(`Upstream site returned HTTP ${page.status}`);
      }

      const articles = extractHtmlArticleCandidates(page.text, page.url);
      const escapeXml = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      const nowRfc822 = new Date().toUTCString();
      const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(page.url)}</link>
    <description>Generated RSS feed extracted from ${escapeXml(page.url)}</description>
    <lastBuildDate>${nowRfc822}</lastBuildDate>
    ${articles
      .map(
        a => `<item>
      <title>${escapeXml(a.title)}</title>
      <link>${escapeXml(a.url)}</link>
      <guid isPermaLink="true">${escapeXml(a.url)}</guid>
    </item>`
      )
      .join('\n    ')}
  </channel>
</rss>`;

      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.send(rssXml);
    } catch (err: any) {
      const status = err instanceof BlockedUrlError ? 400 : 500;
      res.status(status).send(err?.message || 'Failed to generate RSS feed');
    }
  });

  // Vite middleware for development (HMR disabled in cloud iframe to prevent WebSocket closed errors)
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: false,
      allowedHosts: true,
    }
  });

  app.use(vite.middlewares);

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
