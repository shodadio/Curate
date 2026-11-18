import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';
import fs from 'fs';
import { DEFAULT_FEEDS } from './src/defaultFeeds';
import { MAX_PAGE_BYTES, MAX_REDIRECTS, BlockedUrlError, assertPublicHttpUrl, guardedLookup } from './lib/ssrf';
import {
  blendSemanticScores,
  buildDenseCentroid,
  buildDeterministicDigest,
  buildExposurePenalty,
  buildWhyLine,
  cosineSimilarity,
  localSemanticScores,
  maxPerSourceFor,
  scoreCandidates,
  selectDiverse,
  stableJitter,
  type SemanticVoteExample,
} from './lib/ranking';
import { parseOpmlText } from './lib/opml';
import { cleanHtml, htmlToReadableText } from './lib/markup';
import { parseFeedChannelDescription, parseFeedSiteUrl, parseSitePageDescription } from './lib/sourceMetadata';

dotenv.config();

// ---- Public-route protection -------------------------------------------------
// The AI routes spend real money and this app has no accounts, so the only lever is a
// per-client budget. Buckets live in memory: they reset on a redeploy, which is fine for
// abuse control at this scale and costs nothing per request.
const ALLOW_SERVER_KEY = process.env.ALLOW_SERVER_KEY === '1';
const RATE_WINDOW_MS = 60_000;

interface RateBucket {
  used: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

// Cloud Run forwards the real client in X-Forwarded-For. Only believe it when the
// deployment says the proxy is trusted — otherwise the header is client-controlled.
function clientAddress(req: express.Request): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimit(scope: string, limit: number, windowMs = RATE_WINDOW_MS) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now();
    const key = `${scope}|${clientAddress(req)}`;
    const bucket = rateBuckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(key, { used: 1, resetAt: now + windowMs });
      // Drop expired buckets so a busy public URL cannot grow this map without bound.
      if (rateBuckets.size > 5000) {
        rateBuckets.forEach((value, mapKey) => {
          if (value.resetAt <= now) rateBuckets.delete(mapKey);
        });
      }
      next();
      return;
    }

    if (bucket.used >= limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Too many requests from this connection. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    bucket.used += 1;
    next();
  };
}

// A route that never answers leaves the client spinning and the server still spending.
// Slow routes get a hard budget and a retryable 503 instead of an open socket.
function requestBudget(label: string, ms: number) {
  return (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const timer = setTimeout(() => {
      if (res.headersSent || res.writableEnded) return;
      res.status(503).json({
        error: `${label} took longer than ${Math.round(ms / 1000)}s. Please try again — the server may still be waking up.`,
        retryable: true,
      });
      // The handler is still running and will try to answer; those writes must not throw
      // on the response this timeout has just ended.
      const noop = (() => res) as unknown;
      res.json = noop as typeof res.json;
      res.send = noop as typeof res.send;
      res.end = noop as typeof res.end;
    }, ms);

    const clear = () => clearTimeout(timer);
    res.on('finish', clear);
    res.on('close', clear);
    next();
  };
}

interface ProviderRequestConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

function providerEndpoint(baseUrl: string, route: string): string {
  const url = new URL(baseUrl.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Provider base URL must be an HTTPS URL without credentials, query parameters, or a fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${route}`;
  return url.toString();
}

async function postProviderJson(targetUrl: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const url = await assertPublicHttpUrl(targetUrl);
  if (url.protocol !== 'https:') throw new Error('AI provider endpoints must use HTTPS.');

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      lookup: guardedLookup as unknown as net.LookupFunction,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      const status = res.statusCode || 0;
      let text = '';
      let size = 0;
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        size += Buffer.byteLength(chunk);
        if (size > 2 * 1024 * 1024) {
          res.destroy(new Error('AI provider response exceeded the 2 MB limit.'));
          return;
        }
        text += chunk;
      });
      res.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`AI provider error: ${status} ${text.slice(0, 1000)}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('AI provider returned invalid JSON.'));
        }
      });
      res.on('error', reject);
    });

    req.setTimeout(30000, () => req.destroy(new Error('AI provider request timed out.')));
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function parseModelJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const array = candidate.match(/\[[\s\S]*\]/);
    const object = candidate.match(/\{[\s\S]*\}/);
    const recovered = array?.[0] || object?.[0];
    if (recovered) return JSON.parse(recovered);
    throw new Error('AI provider did not return valid JSON.');
  }
}

// The reply text of an OpenAI-style chat completion, whether the provider returns a
// plain string or an array of content parts.
const readOpenAIChatText = (data: any): string => {
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
};

async function callOpenAICompatible(config: ProviderRequestConfig, prompt: string): Promise<any> {
  const data = await postProviderJson(
    providerEndpoint(config.baseUrl, 'chat/completions'),
    { Authorization: `Bearer ${config.apiKey}` },
    { model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 },
  );
  recordModelUsage({
    input: data?.usage?.prompt_tokens,
    cachedInput: data?.usage?.prompt_tokens_details?.cached_tokens,
    output: data?.usage?.completion_tokens,
  });
  const text = readOpenAIChatText(data);
  if (!text) throw new Error('AI provider returned no message content.');
  return parseModelJson(text);
}

async function postAnthropicMessage(
  apiKey: string,
  prompt: string,
  model: string,
  maxTokens: number,
): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  recordModelUsage({
    input: data?.usage?.input_tokens,
    cachedInput: data?.usage?.cache_read_input_tokens,
    output: data?.usage?.output_tokens,
  });
  const text = data.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Anthropic returned no message content.');
  return text;
}

async function callAnthropic(apiKey: string, prompt: string, model: string): Promise<any> {
  return parseModelJson(await postAnthropicMessage(apiKey, prompt, model, 4096));
}

interface PageResponse {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Usage tally
// What the app actually asks of the network, counted where it happens: every
// outbound HTTP request, every feed fetch, every AI call and its tokens. Daily
// buckets are kept for four months so Settings can show day/week/month totals.
// ---------------------------------------------------------------------------

const USD_PER_GBP = 1.32; // £1 = $1.32
// Published per-1M-token rates, off-peak; peak windows double them.
const TOKEN_RATES = { inputMiss: 0.15, inputHit: 0.003, output: 0.6 };
const PEAK_WINDOWS_UTC: Array<[number, number]> = [[1, 4], [6, 10]];
const USAGE_RETENTION_DAYS = 120;

interface UsageBucket {
  date: string;
  apiCalls: number;
  outboundRequests: number;
  feedFetches: number;
  aiCalls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usd: number;
}

const emptyUsageBucket = (date: string): UsageBucket => ({
  date,
  apiCalls: 0,
  outboundRequests: 0,
  feedFetches: 0,
  aiCalls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  usd: 0,
});

const usageBuckets = new Map<string, UsageBucket>();
const USAGE_FILE = path.join(process.cwd(), 'usage-stats.json');
let usageSaveTimer: NodeJS.Timeout | null = null;

const utcDay = (at: number = Date.now()): string => new Date(at).toISOString().slice(0, 10);

const loadUsage = () => {
  try {
    if (!fs.existsSync(USAGE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (!Array.isArray(raw?.days)) return;
    raw.days.forEach((entry: any) => {
      if (entry && typeof entry.date === 'string') {
        usageBuckets.set(entry.date, { ...emptyUsageBucket(entry.date), ...entry });
      }
    });
  } catch { /* a corrupt file just means a fresh tally */ }
};

const saveUsage = () => {
  try {
    const oldest = utcDay(Date.now() - USAGE_RETENTION_DAYS * 86400000);
    [...usageBuckets.keys()].forEach(date => {
      if (date < oldest) usageBuckets.delete(date);
    });
    const days = [...usageBuckets.values()].sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(USAGE_FILE, JSON.stringify({ days }));
  } catch { /* tally is best-effort, never break a request over it */ }
};

// Batched write so a burst of feed fetches does not hit the disk per request
const scheduleUsageSave = () => {
  if (usageSaveTimer) return;
  usageSaveTimer = setTimeout(() => {
    usageSaveTimer = null;
    saveUsage();
  }, 4000);
};

const currentUsageBucket = (date: string = utcDay()): UsageBucket => {
  let bucket = usageBuckets.get(date);
  if (!bucket) {
    bucket = emptyUsageBucket(date);
    usageBuckets.set(date, bucket);
  }
  return bucket;
};

const usageDelta = (patch: Partial<Omit<UsageBucket, 'date'>>) => {
  const bucket = currentUsageBucket();
  (Object.keys(patch) as Array<keyof Omit<UsageBucket, 'date'>>).forEach(key => {
    const value = patch[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (bucket as any)[key] += value;
    }
  });
  scheduleUsageSave();
};

// Mon–Fri 01:00–04:00 and 06:00–10:00 UTC are the provider's peak windows
const isPeakPricing = (at: number = Date.now()): boolean => {
  const date = new Date(at);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end);
};

// One AI call plus whatever token counts the provider reported for it
const recordModelUsage = (usage: { input?: number; cachedInput?: number; output?: number } | null | undefined) => {
  const input = Math.max(0, Number(usage?.input) || 0);
  const cachedInput = Math.min(input, Math.max(0, Number(usage?.cachedInput) || 0));
  const output = Math.max(0, Number(usage?.output) || 0);
  const multiplier = isPeakPricing() ? 2 : 1;
  const usd = (
    (input - cachedInput) * TOKEN_RATES.inputMiss +
    cachedInput * TOKEN_RATES.inputHit +
    output * TOKEN_RATES.output
  ) / 1_000_000 * multiplier;

  usageDelta({ aiCalls: 1, inputTokens: input, cachedInputTokens: cachedInput, outputTokens: output, usd });
};

// Gemini reports usage in its own shape
const recordGeminiUsage = (response: any) => {
  const meta = response?.usageMetadata;
  recordModelUsage({
    input: meta?.promptTokenCount,
    cachedInput: meta?.cachedContentTokenCount,
    output: meta?.candidatesTokenCount,
  });
};

loadUsage();

function requestOnce(url: URL, timeoutMs: number): Promise<{ redirectTo?: string; page?: PageResponse }> {
  usageDelta({ outboundRequests: 1 });
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
  app.use(express.json({ limit: '25mb' }));
  // Count the calls the app makes into its own server (the usage route excludes itself)
  app.use('/api', (req, _res, next) => {
    if (!req.path.startsWith('/usage')) usageDelta({ apiCalls: 1 });
    next();
  });

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
  const semanticEmbeddingCache = new Map<string, number[]>();

  const embedSemanticTexts = async (
    texts: string[],
    config: { provider: string; apiKey: string; baseUrl: string; model: string },
  ): Promise<Array<number[] | null>> => {
    const results: Array<number[] | null> = Array(texts.length).fill(null);
    const provider = config.provider;
    if (provider === 'none' || texts.length === 0) return results;

    const apiKey = config.apiKey || (provider === 'gemini' ? process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '' : '');
    const model = config.model.trim() || (provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small');
    const baseUrl = config.baseUrl.trim();
    if (!apiKey || (provider === 'openai-compatible' && !baseUrl)) return results;
    if (provider !== 'openai-compatible' && provider !== 'gemini') return results;

    const cachePrefix = `${provider}|${baseUrl}|${model}|`;
    const pending: Array<{ index: number; text: string; cacheKey: string }> = [];
    texts.forEach((text, index) => {
      const cacheKey = `${cachePrefix}${text}`;
      const cached = semanticEmbeddingCache.get(cacheKey);
      if (cached) results[index] = cached;
      else pending.push({ index, text, cacheKey });
    });

    const gemini = provider === 'gemini'
      ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
      : null;

    for (let start = 0; start < pending.length; start += 50) {
      const batch = pending.slice(start, start + 50);
      let vectors: any[] = [];
      if (provider === 'gemini' && gemini) {
        const response = await gemini.models.embedContent({
          model,
          contents: batch.map(item => item.text),
          config: { taskType: 'SEMANTIC_SIMILARITY', outputDimensionality: 768 },
        });
        recordGeminiUsage(response);
        vectors = (response.embeddings || []).map(item => item?.values);
      } else {
        const response = await postProviderJson(
          providerEndpoint(baseUrl, 'embeddings'),
          { Authorization: `Bearer ${apiKey}` },
          { model, input: batch.map(item => item.text) },
        );
        recordModelUsage({ input: response?.usage?.prompt_tokens, output: 0 });
        vectors = Array.isArray(response.data)
          ? [...response.data].sort((a: any, b: any) => (a.index || 0) - (b.index || 0)).map((item: any) => item.embedding)
          : [];
      }

      batch.forEach((item, index) => {
        const values = vectors[index];
        if (!Array.isArray(values) || values.length === 0) return;
        const rawVector = values.map(Number);
        if (rawVector.some(value => !Number.isFinite(value))) return;
        const magnitude = Math.sqrt(rawVector.reduce((sum, value) => sum + value * value, 0));
        if (magnitude === 0) return;
        const vector = rawVector.map(value => value / magnitude);
        results[item.index] = vector;
        if (semanticEmbeddingCache.size >= 1000) {
          const oldestKey = semanticEmbeddingCache.keys().next().value;
          if (oldestKey) semanticEmbeddingCache.delete(oldestKey);
        }
        semanticEmbeddingCache.set(item.cacheKey, vector);
      });
    }

    return results;
  };

  // Lightweight liveness check used at app startup before provider requests are attempted.
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, service: 'curator' });
  });

  // API Routes
  // Source icons. The page used to load these straight from google.com, which made every card
  // a third-party request and contradicted the local-first claim. They are fetched here instead,
  // cached in memory, and served from our own origin.
  const FAVICON_TTL_MS = 1000 * 60 * 60 * 24 * 7;
  const FAVICON_CACHE_MAX = 500;
  const FAVICON_FAIL_TTL_MS = 1000 * 60 * 10;
  const faviconCache = new Map<string, { at: number; type: string; body: Buffer }>();
  const faviconFailures = new Map<string, number>();

  // Some sites only answer with an icon file rather than a scaled PNG, and Google has none at
  // all for hosts like feeds.arstechnica.com. Try both before telling the browser there is
  // nothing, because a failed <img> leaves the card with bare initials.
  const fetchIconBytes = async (targetUrl: string): Promise<{ body: Buffer; type: string } | null> => {
    let url: URL;
    try {
      url = await assertPublicHttpUrl(targetUrl);
    } catch {
      return null;
    }
    const isHttps = url.protocol === 'https:';
    const requester = isHttps ? https.request : http.request;
    return new Promise(resolve => {
      let settled = false;
      const finish = (value: { body: Buffer; type: string } | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const req = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ''),
          port: url.port || (isHttps ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          lookup: guardedLookup as unknown as net.LookupFunction,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CuratorFavicon/1.0)',
            'Accept': 'image/*,*/*;q=0.8',
            'Accept-Encoding': 'identity',
          },
        },
        res => {
          const status = res.statusCode || 0;
          const type = String(res.headers['content-type'] || '');
          // An HTML error page is not an icon.
          if (status < 200 || status >= 300 || /text\/html/i.test(type)) {
            res.resume();
            finish(null);
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 256 * 1024) {
              res.destroy();
              finish(null);
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => finish(chunks.length ? { body: Buffer.concat(chunks), type: type || 'image/x-icon' } : null));
          res.on('error', () => finish(null));
        },
      );
      req.setTimeout(6000, () => req.destroy(new Error('Request timed out')));
      req.on('error', () => finish(null));
      req.end();
    });
  };

  const fetchGoogleIcon = async (domain: string): Promise<{ body: Buffer; type: string } | null> => {
    try {
      const upstream = await fetch(
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
        { headers: { 'User-Agent': 'Curator/1.0 (favicon proxy)' }, signal: AbortSignal.timeout(6000) }
      );
      if (!upstream.ok) return null;
      const body = Buffer.from(await upstream.arrayBuffer());
      if (!body.length || body.length > 512 * 1024) return null;
      return { body, type: upstream.headers.get('content-type') || 'image/png' };
    } catch {
      return null;
    }
  };

  // Cards draw a source icon at about 36 pixels, which is 72 device pixels on a retina screen.
  // A 16×16 favicon has to be upscaled to get there, which is what left some cards looking
  // blurry, so an icon is only taken as-is when it clears this edge. SVG has no fixed size and
  // counts as sharp; a format we cannot measure (WebP, say) is kept rather than guessed at.
  const ICON_SHARP_EDGE = 64;

  const iconEdge = (body: Buffer, type: string): number => {
    if (/svg/i.test(type)) return Number.POSITIVE_INFINITY;
    if (body.length >= 24 && body.subarray(1, 4).toString('ascii') === 'PNG') {
      return Math.min(body.readUInt32BE(16), body.readUInt32BE(20));
    }
    // An .ico is a directory of several sizes; the largest is the one a browser picks.
    if (body.length >= 22 && body.readUInt16LE(0) === 0 && body.readUInt16LE(2) === 1) {
      const count = body.readUInt16LE(4);
      let largest = 0;
      for (let index = 0; index < count && 6 + index * 16 + 2 <= body.length; index += 1) {
        const width = body[6 + index * 16] || 256;
        const height = body[6 + index * 16 + 1] || 256;
        largest = Math.max(largest, Math.min(width, height));
      }
      return largest;
    }
    if (body.length >= 10 && /^GIF8[79]a$/.test(body.subarray(0, 6).toString('ascii'))) {
      return Math.min(body.readUInt16LE(6), body.readUInt16LE(8));
    }
    if (body.length >= 4 && body[0] === 0xff && body[1] === 0xd8) {
      let offset = 2;
      while (offset + 9 < body.length) {
        if (body[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = body[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return Math.min(body.readUInt16BE(offset + 7), body.readUInt16BE(offset + 5));
        }
        offset += 2 + body.readUInt16BE(offset + 2);
      }
    }
    return Number.POSITIVE_INFINITY;
  };

  // A site that ships a 16×16 favicon usually still declares a bigger one — an apple-touch-icon
  // or a 192-pixel PNG — on its own home page. Reading those declarations is what makes the
  // card sharp without asking a third party for a logo.
  const parseIconLinks = (html: string, baseUrl: string): string[] => {
    const scored: Array<{ href: string; score: number }> = [];
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const rel = (/(?:\brel\s*=\s*["']([^"']*)["'])/i.exec(tag)?.[1] || '').toLowerCase();
      const href = /(?:\bhref\s*=\s*["']([^"']+)["'])/i.exec(tag)?.[1];
      if (!href || !/\b(?:apple-touch-icon|icon)\b/.test(rel)) continue;
      let resolved: URL;
      try {
        resolved = new URL(href.replace(/&amp;/gi, '&'), baseUrl);
      } catch {
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      const sizes = /\bsizes\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || '';
      let score = Math.max(0, ...[...sizes.matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)].map(match => Number(match[1])));
      if (/apple-touch-icon/.test(rel)) score = Math.max(score, /precomposed/.test(rel) ? 150 : 180);
      if (/\.svg(?:[?#]|$)/i.test(resolved.pathname)) score = Math.max(score, 120);
      scored.push({ href: resolved.toString(), score });
    }
    return scored.sort((a, b) => b.score - a.score).map(entry => entry.href);
  };

  interface WebAppManifest {
    icons?: Array<{ src?: unknown; sizes?: unknown; type?: unknown }>;
  }

  // Plenty of sites keep their real sizes in the web app manifest, which the page only links to.
  const parseManifestIconLinks = (manifest: WebAppManifest, baseUrl: string): string[] => {
    if (!Array.isArray(manifest?.icons)) return [];
    const scored: Array<{ href: string; score: number }> = [];
    for (const icon of manifest.icons) {
      const src = typeof icon?.src === 'string' ? icon.src : '';
      if (!src) continue;
      let resolved: URL;
      try {
        resolved = new URL(src, baseUrl);
      } catch {
        continue;
      }
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      const declared = Math.max(0, ...[...String(icon.sizes || '').matchAll(/(\d+)\s*[x×]\s*(\d+)/gi)].map(match => Number(match[1])));
      const scalable = /svg/i.test(String(icon.type || '')) || /\.svg(?:[?#]|$)/i.test(resolved.pathname);
      scored.push({ href: resolved.toString(), score: declared || (scalable ? 512 : 0) });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(entry => entry.href);
  };

  const fetchDeclaredIcon = async (host: string): Promise<{ body: Buffer; type: string } | null> => {
    let page;
    try {
      page = await fetchPublicPage(`https://${host}/`, 5000);
    } catch {
      return null;
    }
    if (!page?.ok || !page.text) return null;
    if (page.contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType)) return null;

    const pageUrl = page.url || `https://${host}/`;
    const hrefs = parseIconLinks(page.text, pageUrl);

    const manifestTag = (page.text.match(/<link\b[^>]*>/gi) || [])
      .find(tag => /rel\s*=\s*["'][^"']*manifest/i.test(tag));
    const manifestHref = manifestTag ? /href\s*=\s*["']([^"']+)["']/i.exec(manifestTag)?.[1] : undefined;
    if (manifestHref) {
      try {
        const manifestUrl = new URL(manifestHref.replace(/&amp;/gi, '&'), pageUrl);
        const manifestPage = await fetchPublicPage(manifestUrl.toString(), 4000);
        if (manifestPage?.ok && manifestPage.text) {
          hrefs.unshift(...parseManifestIconLinks(JSON.parse(manifestPage.text), manifestUrl.toString()));
        }
      } catch {
        // A manifest that is missing or is not JSON simply contributes no icons.
      }
    }

    let best: { body: Buffer; type: string } | null = null;
    let bestEdge = -1;
    for (const href of hrefs.slice(0, 6)) {
      const icon = await fetchIconBytes(href);
      if (!icon) continue;
      const edge = iconEdge(icon.body, icon.type);
      if (edge > bestEdge) {
        best = icon;
        bestEdge = edge;
      }
      if (edge >= ICON_SHARP_EDGE) return icon;
    }
    return best;
  };

  // Older sites declare no icons at all but still answer the conventional touch-icon paths.
  const fetchWellKnownTouchIcon = async (host: string): Promise<{ body: Buffer; type: string } | null> => {
    for (const path of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
      const icon = await fetchIconBytes(`https://${host}${path}`);
      if (icon && iconEdge(icon.body, icon.type) >= ICON_SHARP_EDGE) return icon;
    }
    return null;
  };

  // A feed host is usually not the publishing host — feeds.arstechnica.com carries no icon
  // while arstechnica.com does — so each name is also tried as its parent domain.
  const faviconCandidates = (domain: string): string[] => {
    const labels = domain.split('.');
    return labels.length > 2 ? [domain, labels.slice(-2).join('.')] : [domain];
  };

  app.get('/api/favicon', rateLimit('favicon', 400), async (req, res) => {
    const domain = String(req.query.domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    // A real hostname: dot-separated labels and an alphabetic TLD. Rejects '..', 'localhost'
    // and anything path-like before it can reach the upstream fetch.
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
      res.status(400).json({ error: 'Invalid domain' });
      return;
    }
    const cached = faviconCache.get(domain);
    if (cached && Date.now() - cached.at < FAVICON_TTL_MS) {
      res.setHeader('Content-Type', cached.type);
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(FAVICON_TTL_MS / 1000)}`);
      res.end(cached.body);
      return;
    }
    // A domain that just failed is not retried on every render; the browser caches the
    // failure itself for ten minutes.
    const failedAt = faviconFailures.get(domain);
    if (failedAt && Date.now() - failedAt < FAVICON_FAIL_TTL_MS) {
      res.status(502).end();
      return;
    }
    try {
      type SourceIcon = { body: Buffer; type: string };
      const candidates = faviconCandidates(domain);
      // Cheapest source first, and only a sharp icon stops the search: Google's service hands
      // back whatever size the site actually has, so a 16×16 answer is a reason to look at the
      // site's own declared icons rather than a reason to stop.
      const attempts: Array<() => Promise<SourceIcon | null>> = [
        ...candidates.map(candidate => () => fetchGoogleIcon(candidate)),
        ...candidates.map(candidate => () => fetchDeclaredIcon(candidate)),
        ...candidates.map(candidate => () => fetchWellKnownTouchIcon(candidate)),
        ...candidates.map(candidate => () => fetchIconBytes(`https://${candidate}/favicon.ico`)),
      ];
      let icon: SourceIcon | null = null;
      let fallback: SourceIcon | null = null;
      let fallbackEdge = -1;
      for (const attempt of attempts) {
        const next = await attempt();
        if (!next) continue;
        const edge = iconEdge(next.body, next.type);
        if (edge > fallbackEdge) {
          fallback = next;
          fallbackEdge = edge;
        }
        if (edge >= ICON_SHARP_EDGE) {
          icon = next;
          break;
        }
      }
      // Nothing sharp exists: a small icon still beats bare initials.
      if (!icon) icon = fallback;
      if (!icon) throw new Error('unusable favicon');
      if (faviconCache.size >= FAVICON_CACHE_MAX) {
        const oldest = faviconCache.keys().next().value;
        if (oldest) faviconCache.delete(oldest);
      }
      faviconCache.set(domain, { at: Date.now(), type: icon.type, body: icon.body });
      faviconFailures.delete(domain);
      res.setHeader('Content-Type', icon.type);
      res.setHeader('Cache-Control', `public, max-age=${Math.floor(FAVICON_TTL_MS / 1000)}`);
      res.end(icon.body);
    } catch {
      faviconFailures.set(domain, Date.now());
      res.status(502).end();
    }
  });

  app.get('/api/usage', (_req, res) => {
    const today = utcDay();
    const sumOver = (days: number): UsageBucket => {
      const from = utcDay(Date.now() - (days - 1) * 86400000);
      const total = emptyUsageBucket(`${from}..${today}`);
      usageBuckets.forEach(bucket => {
        if (bucket.date < from || bucket.date > today) return;
        total.apiCalls += bucket.apiCalls;
        total.outboundRequests += bucket.outboundRequests;
        total.feedFetches += bucket.feedFetches;
        total.aiCalls += bucket.aiCalls;
        total.inputTokens += bucket.inputTokens;
        total.cachedInputTokens += bucket.cachedInputTokens;
        total.outputTokens += bucket.outputTokens;
        total.usd += bucket.usd;
      });
      return total;
    };
    const withPounds = (bucket: UsageBucket) => ({ ...bucket, gbp: bucket.usd / USD_PER_GBP });
    const monthStart = utcDay(Date.now() - 29 * 86400000);

    res.json({
      today: withPounds(sumOver(1)),
      week: withPounds(sumOver(7)),
      month: withPounds(sumOver(30)),
      days: [...usageBuckets.values()]
        .filter(bucket => bucket.date >= monthStart)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(withPounds),
      usdPerGbp: USD_PER_GBP,
      peakNow: isPeakPricing(),
      rates: TOKEN_RATES,
      retentionDays: USAGE_RETENTION_DAYS,
    });
  });

  app.get('/api/semantic-status', (_req, res) => {
    res.json({
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
      localEngine: true,
    });
  });

  // "Test API": one minimal request with the settings shown in the app, so a wrong key,
  // URL or model surfaces in Settings instead of silently falling back during a digest.
  app.post('/api/test-provider', rateLimit('test-provider', 10), async (req, res) => {
    const started = Date.now();
    const kind = req.body?.kind === 'embedding' ? 'embedding' : 'chat';
    const provider = String(req.body?.provider || '').trim();
    const apiKey = String(req.body?.apiKey || '').trim();
    const baseUrl = String(req.body?.baseUrl || '').trim();
    const requestedModel = String(req.body?.model || '').trim();
    const pingPrompt = 'Reply with the single word: pong';

    try {
      if (kind === 'chat') {
        if (provider === 'deterministic') {
          return res.json({ ok: true, provider, model: 'built-in', latencyMs: 0, reply: 'Built-in engine — nothing to reach.' });
        }

        if (provider === 'openai-compatible') {
          if (!apiKey) throw new Error('Add a chat API key first.');
          if (!baseUrl) throw new Error('Add a chat API base URL first.');
          const model = requestedModel || 'gpt-4o-mini';
          const data = await postProviderJson(
            providerEndpoint(baseUrl, 'chat/completions'),
            { Authorization: `Bearer ${apiKey}` },
            { model, messages: [{ role: 'user', content: pingPrompt }], max_tokens: 16 },
          );
          const reply = readOpenAIChatText(data).trim();
          if (!reply) throw new Error('The provider answered but returned no text.');
          return res.json({ ok: true, provider, model, latencyMs: Date.now() - started, reply });
        }

        if (provider === 'anthropic') {
          if (!apiKey) throw new Error('Add an Anthropic API key first.');
          const model = requestedModel || 'claude-3-5-sonnet-20241022';
          const reply = (await postAnthropicMessage(apiKey, pingPrompt, model, 16)).trim();
          return res.json({ ok: true, provider, model, latencyMs: Date.now() - started, reply });
        }

        if (provider === 'gemini') {
          const gemini = apiKey
            ? new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
            : ai;
          if (!gemini) throw new Error('Add a Gemini key here or set GEMINI_API_KEY on the server.');
          const model = requestedModel || 'gemini-2.5-flash';
          const response = await gemini.models.generateContent({
            model,
            contents: pingPrompt,
            config: { maxOutputTokens: 16 },
          });
          recordGeminiUsage(response);
          const reply = String(response.text || '').trim();
          if (!reply) throw new Error('Gemini answered but returned no text.');
          return res.json({ ok: true, provider, model, latencyMs: Date.now() - started, reply });
        }

        throw new Error(`Unknown provider “${provider}”.`);
      }

      // Embeddings ping: verifies the key, endpoint and model, and reports vector width.
      if (provider === 'none') {
        return res.json({ ok: true, provider, model: 'built-in', latencyMs: 0 });
      }
      if (provider !== 'openai-compatible' && provider !== 'gemini') {
        throw new Error(`Unknown embeddings provider “${provider}”.`);
      }
      if (provider === 'gemini' && !apiKey && !ai) {
        throw new Error('Add a Gemini key here or set GEMINI_API_KEY on the server.');
      }
      if (provider === 'openai-compatible') {
        if (!apiKey) throw new Error('Add an embeddings API key, or reuse the chat key, first.');
        if (!baseUrl) throw new Error('Add an embeddings API base URL first.');
      }

      const vectors = await embedSemanticTexts(['Curator ping'], {
        provider,
        apiKey,
        baseUrl,
        model: requestedModel,
      });
      const vector = vectors[0];
      if (!vector || vector.length === 0) {
        throw new Error('No embedding came back — check the key, base URL and model.');
      }

      return res.json({
        ok: true,
        provider,
        model: requestedModel || (provider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small'),
        latencyMs: Date.now() - started,
        dimensions: vector.length,
      });
    } catch (err: any) {
      return res.json({
        ok: false,
        error: err?.message || 'The test request failed.',
        latencyMs: Date.now() - started,
      });
    }
  });

  // OPML Parser endpoint
  app.post('/api/parse-opml', rateLimit('opml', 6), (req, res) => {
    try {
      const { opmlText } = req.body;
      if (!opmlText || typeof opmlText !== 'string' || !opmlText.trim()) {
        return res.status(400).json({ error: 'No OPML content provided' });
      }

      const { sources, failures, foundAnyOutline } = parseOpmlText(opmlText);

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
  const normalizeFeedCategories = (raw: unknown, folder: string): string[] => {
    const labels = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const categories: string[] = [];
    for (const value of labels) {
      if (typeof value !== 'string') continue;
      const label = value.replace(/\s+/g, ' ').trim().slice(0, 40);
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      categories.push(label);
    }
    return Array.isArray(raw) ? categories : [folder || 'General'];
  };

  // DEFAULT_FEEDS comes from src/defaultFeeds.ts, the same list the client seeds its library
  // with, so a first-run digest draws on exactly what the server falls back to.

  // Relative only while it is genuinely today; everything older carries the full date and year,
  // matching the "Built … · Nov 17, 2026" line on the digest. Hours alone were wrong: at 1am a
  // story from 9am yesterday is 16 hours old but still says "Today".
  const formatPublishDate = (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr || 'Recently';
      const now = new Date();
      const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
      if (d.toDateString() === now.toDateString() && diffMins >= 0) {
        return diffMins < 60
          ? `Today · ${Math.max(1, diffMins)}m ago`
          : `Today · ${Math.floor(diffMins / 60)}h ago`;
      }
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const parseFeedItems = (xml: string, sourceTitle: string, folder: string, baseUrl: string, categories: string[]): any[] => {
    const items: any[] = [];
    const feedDescription = parseFeedChannelDescription(xml);
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
        const linkTagMatch = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
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
      // Some feeds publish a year-less date ("Sep 11"). Date() anchors those to 2001,
      // which would file this year's posts below everything else, so pin the current year.
      const dated = rawDate && !/\b\d{4}\b/.test(rawDate)
        ? `${rawDate} ${new Date().getFullYear()}`
        : rawDate;
      const publishedAt = formatPublishDate(dated);
      const publishedAtMs = dated ? new Date(dated).getTime() : NaN;

      const contentMatch = block.match(/<(?:content:encoded|content)[^>]*>([\s\S]*?)<\/(?:content:encoded|content)>/i);
      const descMatch = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
      const summaryMatch = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);

      const fullRaw = contentMatch ? contentMatch[1] : (descMatch ? descMatch[1] : (summaryMatch ? summaryMatch[1] : ''));
      // The item's own address is the base for any relative link inside its body.
      const cleanFull = htmlToReadableText(fullRaw, link);

      const summaryRaw = summaryMatch ? summaryMatch[1] : (descMatch ? descMatch[1] : fullRaw);
      let summary = cleanHtml(summaryRaw);
      if (summary.length > 280) {
        summary = summary.slice(0, 277).replace(/\s+\S*$/, '') + '...';
      }
      if (!summary) {
        summary = title;
      }

      let bannerImage: string | undefined;
      const mediaTags = block.match(/<media:(?:content|thumbnail)\b[^>]*>/gi) || [];
      for (const tag of mediaTags) {
        const urlMatch = tag.match(/\burl\s*=\s*["']([^"']+)["']/i);
        const isImage = /<media:thumbnail\b/i.test(tag) ||
          /\bmedium\s*=\s*["']image["']/i.test(tag) ||
          /\btype\s*=\s*["']image\/[^"']+["']/i.test(tag) ||
          (urlMatch && /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(urlMatch[1]));
        if (isImage && urlMatch) {
          bannerImage = urlMatch[1];
          break;
        }
      }

      if (!bannerImage) {
        const enclosureMatch = block.match(/<enclosure\b[^>]*url\s*=\s*["']([^"']+)["'][^>]*type\s*=\s*["']image\/[^"']+["'][^>]*>/i) ||
          block.match(/<enclosure\b[^>]*type\s*=\s*["']image\/[^"']+["'][^>]*url\s*=\s*["']([^"']+)["'][^>]*>/i);
        if (enclosureMatch && enclosureMatch[1]) bannerImage = enclosureMatch[1];
      }

      if (!bannerImage) {
        const imgMatch = fullRaw.match(/<img\b[^>]*src\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/i);
        if (imgMatch && imgMatch[1] && !imgMatch[1].includes('feedburner') && !imgMatch[1].includes('tracking') && !imgMatch[1].includes('spacer')) {
          bannerImage = imgMatch[1];
        }
      }

      const words = cleanFull.split(/\s+/).filter(Boolean).length;
      const minutes = Math.max(2, Math.round(words / 200));
      const readTime = `${minutes} min read`;
      const hasContinuationMarker = /(?:\.{3}|…|\[\s*…\s*\])\s*$/.test(cleanFull) ||
        /\b(?:continue reading|read (?:the )?(?:full )?(?:article|story)|read more)\b/i.test(cleanFull.slice(-250)) ||
        /\b(?:continue reading|read more)\b/i.test(fullRaw);

      const idHash = Buffer.from(link || title).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
      const id = `live_${idHash}`;

      items.push({
        id,
        source: sourceTitle,
        sourceDescription: feedDescription || undefined,
        folder: folder || 'General',
        categories,
        title,
        summary,
        readTime,
        url: link,
        fullText: cleanFull.length > 120 ? cleanFull : (summary + '\n\n' + 'Read the complete article directly at: ' + link),
        // This text came from the cleaner that keeps a link's address, so a reader holding it
        // needs no refresh. Saves written before that change lack the flag and are refreshed.
        linksCleaned: true,
        _needsArticleFetch: Boolean(link && cleanFull.length > 80 && hasContinuationMarker),
        publishedAt,
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : undefined,
        bannerImage,
        isOutOfBubble: false,
        why: `From your ${sourceTitle} subscription.`
      });
    }
    return items;
  };

  interface ArticleTextCacheEntry {
    timestamp: number;
    text: string;
  }
  const articleTextCache = new Map<string, ArticleTextCacheEntry>();
  const ARTICLE_TEXT_CACHE_TTL = 24 * 60 * 60 * 1000;
  const ARTICLE_TEXT_FAILURE_TTL = 10 * 60 * 1000;
  const MAX_ARTICLE_TEXT_CACHE_ENTRIES = 300;

  const extractArticleBody = (html: string, baseUrl = ''): string => {
    const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
    const mainMatch = articleMatch ? null : html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    let body = articleMatch?.[1] || mainMatch?.[1] || '';
    if (!body) return '';

    body = body
      .replace(/<(figure|figcaption|audio|video|iframe|script|style|noscript|svg|form|button|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<h1\b[^>]*>[\s\S]*?<\/h1\s*>/gi, ' ');

    const excludedClassNames = /(?:^|[\s_-])(?:author|byline|related|recommend(?:ation|ed)?|newsletter|subscribe|share|social|audio|player|caption|tldr|standfirst|dek|bio|advert|promoted|read[-_ ]?more|post[-_ ]?meta|article[-_ ]?meta|outbrain|taboola)(?=$|[\s_-])/i;
    const taggedBlocks = /<(div|section|aside|p|h[2-6]|ul|ol)\b[^>]*(?:class|id)\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi;
    for (let pass = 0; pass < 8; pass += 1) {
      let removed = false;
      body = body.replace(taggedBlocks, block => {
        const openingTag = block.match(/^<[^>]+>/)?.[0] || '';
        const labels = [...openingTag.matchAll(/(?:class|id)\s*=\s*["']([^"']*)["']/gi)]
          .map(match => match[1]);
        if (!labels.some(label => excludedClassNames.test(label))) return block;
        removed = true;
        return ' ';
      });
      if (!removed) break;
    }

    const text = htmlToReadableText(body, baseUrl);
    const paragraphs = text.split(/\n{2,}/).filter(paragraph => paragraph.trim().length > 0);
    if (text.length < 600 || paragraphs.length < 3) return '';
    if (/\b(?:subscribe|sign up|create an account)\b.{0,80}\b(?:continue|read|access)\b|\b(?:sign|log) in to\b.{0,80}\b(?:continue|read|access)\b/i.test(text)) {
      return '';
    }
    return text;
  };

  const fetchArticleBody = async (targetUrl: string): Promise<string | null> => {
    let cacheKey = '';
    try {
      const parsedUrl = new URL(targetUrl);
      parsedUrl.hash = '';
      cacheKey = parsedUrl.toString();
    } catch {
      return null;
    }

    const cached = articleTextCache.get(cacheKey);
    const cacheTtl = cached?.text ? ARTICLE_TEXT_CACHE_TTL : ARTICLE_TEXT_FAILURE_TTL;
    if (cached && Date.now() - cached.timestamp < cacheTtl) return cached.text || null;
    if (cached) articleTextCache.delete(cacheKey);

    let text = '';
    try {
      // Reuse the same public-host, redirect, timeout, and response-size checks as feed fetching.
      const page = await fetchPublicPage(cacheKey, 6000);
      if (page.ok && (!page.contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(page.contentType))) {
        text = extractArticleBody(page.text, page.url || cacheKey);
      }
    } catch {
      // Preserve the feed excerpt when an article is unavailable, blocked, or fails extraction.
    }

    if (articleTextCache.size >= MAX_ARTICLE_TEXT_CACHE_ENTRIES) {
      const oldestKey = articleTextCache.keys().next().value;
      if (oldestKey) articleTextCache.delete(oldestKey);
    }
    articleTextCache.set(cacheKey, { timestamp: Date.now(), text });
    return text || null;
  };

  const enrichSelectedArticles = async (digest: any[]): Promise<any[]> => {
    const targets = digest
      .filter(item => item?._needsArticleFetch && typeof item.url === 'string')
      .slice(0, 6);
    let nextTarget = 0;
    const workerCount = Math.min(3, targets.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextTarget < targets.length) {
        const item = targets[nextTarget++];
        const articleText = await fetchArticleBody(item.url);
        if (!articleText) continue;
        item.fullText = articleText;
        const words = articleText.split(/\s+/).filter(Boolean).length;
        item.readTime = `${Math.max(2, Math.round(words / 200))} min read`;
      }
    }));

    return digest.map(item => {
      const { _needsArticleFetch, ...article } = item;
      return article;
    });
  };

  const fetchFeedWithStatus = async (
    feedUrl: string,
    sourceTitle: string,
    folder: string,
    categories?: unknown,
    options: { force?: boolean } = {},
  ): Promise<{ items: any[]; error?: string }> => {
    if (!feedUrl) return { items: [], error: 'No feed URL set' };
    const itemCategories = normalizeFeedCategories(categories, folder);
    const cached = options.force ? undefined : feedCache.get(feedUrl);
    if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL) {
      return { items: cached.items.map(item => ({ ...item, categories: itemCategories })) };
    }
    try {
      usageDelta({ feedFetches: 1 });
      const page = await fetchPublicPage(feedUrl, 7000);
      if (page && page.ok && page.text) {
        const parsed = parseFeedItems(page.text, sourceTitle, folder, feedUrl, itemCategories);
        if (parsed.length > 0) {
          feedCache.set(feedUrl, { timestamp: Date.now(), items: parsed });
          return { items: parsed };
        }
        return { items: [], error: 'No readable articles in the feed' };
      }
      return { items: [], error: `Feed responded with ${page?.status ?? 'an error'}` };
    } catch (err: any) {
      console.warn(`[FeedFetch] Failed to fetch feed for "${sourceTitle}" (${feedUrl}):`, err.message);
      return { items: [], error: err?.message || 'Feed could not be reached' };
    }
  };

  const fetchFeedArticles = async (feedUrl: string, sourceTitle: string, folder: string, categories?: unknown): Promise<any[]> =>
    (await fetchFeedWithStatus(feedUrl, sourceTitle, folder, categories)).items;

  interface SourceDescriptionCacheEntry {
    timestamp: number;
    description: string;
    error?: string;
  }
  const sourceDescriptionCache = new Map<string, SourceDescriptionCacheEntry>();
  const SOURCE_DESCRIPTION_CACHE_TTL = 12 * 60 * 60 * 1000;
  const SOURCE_DESCRIPTION_FAILURE_TTL = 5 * 60 * 1000;

  const fetchSourceDescription = async (feedUrl: string): Promise<{ description: string; error?: string }> => {
    const cached = sourceDescriptionCache.get(feedUrl);
    const cacheTtl = cached?.error ? SOURCE_DESCRIPTION_FAILURE_TTL : SOURCE_DESCRIPTION_CACHE_TTL;
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      return { description: cached.description, error: cached.error };
    }

    let description = '';
    let error: string | undefined;
    try {
      usageDelta({ feedFetches: 1 });
      const feedPage = await fetchPublicPage(feedUrl, 6000);
      if (!feedPage.ok || !feedPage.text) throw new Error(`Feed responded with ${feedPage.status || 'no content'}`);
      description = parseFeedChannelDescription(feedPage.text);

      if (!description) {
        const siteUrl = parseFeedSiteUrl(feedPage.text, feedUrl);
        const sitePage = siteUrl ? await fetchPublicPage(siteUrl, 4500) : null;
        if (sitePage?.ok && (!sitePage.contentType || /(?:text\/html|application\/xhtml\+xml)/i.test(sitePage.contentType))) {
          description = parseSitePageDescription(sitePage.text);
        }
      }
    } catch (err: any) {
      error = err?.message || 'Site description could not be loaded';
    }

    if (sourceDescriptionCache.size >= 500) {
      const oldestKey = sourceDescriptionCache.keys().next().value;
      if (oldestKey) sourceDescriptionCache.delete(oldestKey);
    }
    sourceDescriptionCache.set(feedUrl, { timestamp: Date.now(), description, error });
    return { description, error };
  };

  app.post('/api/source-descriptions', rateLimit('source-descriptions', 18), requestBudget('Loading source descriptions', 55_000), async (req, res) => {
    if (!Array.isArray(req.body?.sources)) {
      res.status(400).json({ error: 'A sources array is required' });
      return;
    }

    const requested = req.body.sources.slice(0, 24);
    const results: Array<{ id: string; description: string; error?: string }> = Array(requested.length);
    let nextIndex = 0;
    const workerCount = Math.min(6, requested.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < requested.length) {
        const index = nextIndex++;
        const source = requested[index];
        const id = typeof source?.id === 'string' ? source.id.slice(0, 200) : '';
        const feedUrl = typeof source?.feedUrl === 'string' ? source.feedUrl.trim() : '';
        if (!id || !feedUrl || feedUrl.length > 2048) {
          results[index] = { id, description: '', error: 'A valid source ID and feed URL are required' };
          continue;
        }
        const metadata = await fetchSourceDescription(feedUrl);
        results[index] = { id, ...metadata };
      }
    }));

    res.json({ sources: results });
  });

  // Curate daily digest from live feeds using configured provider adapters or deterministic ranking
  app.post('/api/curate', rateLimit('curate', 30), requestBudget('Building the digest', 100_000), async (req, res) => {
    try {
      const { sources: clientSources, signals, readingStats, serendipityDial = 30, itemCount = 6 } = req.body;
      const requestedProvider = typeof req.body.provider === 'string' ? req.body.provider : 'deterministic';
      const provider = requestedProvider === 'openai' ? 'openai-compatible' : requestedProvider;
      const clientApiKey = typeof req.body.apiKey === 'string' ? req.body.apiKey : '';
      const clientBaseUrl = typeof req.body.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
      const clientModel = typeof req.body.model === 'string' ? req.body.model.trim() : '';
      const requestedEmbeddingProvider = typeof req.body.embeddingProvider === 'string' ? req.body.embeddingProvider : 'none';
      const embeddingProvider = ['none', 'gemini', 'openai-compatible'].includes(requestedEmbeddingProvider)
        ? requestedEmbeddingProvider
        : 'none';
      const embeddingConfig = {
        provider: embeddingProvider,
        apiKey: (typeof req.body.embeddingApiKey === 'string' ? req.body.embeddingApiKey.trim() : '') ||
          (embeddingProvider === provider ? clientApiKey.trim() : ''),
        baseUrl: (typeof req.body.embeddingBaseUrl === 'string' ? req.body.embeddingBaseUrl.trim() : '') ||
          (embeddingProvider === provider ? clientBaseUrl : ''),
        model: typeof req.body.embeddingModel === 'string' ? req.body.embeddingModel.trim() : '',
      };
      const feedbackExamples: SemanticVoteExample[] =
        Array.isArray(req.body.feedback)
          ? req.body.feedback
              .filter((entry: any) => entry && typeof entry.id === 'string' &&
                (entry.vote === 'like' || entry.vote === 'dislike') &&
                typeof entry.title === 'string' && typeof entry.text === 'string' &&
                Number.isFinite(entry.timestamp))
              .slice(-40)
              .map((entry: any) => ({
                id: entry.id.slice(0, 200),
                vote: entry.vote,
                title: entry.title.slice(0, 300),
                text: entry.text.slice(0, 3000),
                timestamp: entry.timestamp,
                source: typeof entry.source === 'string' ? entry.source.slice(0, 120) : undefined,
                folder: typeof entry.folder === 'string' ? entry.folder.slice(0, 120) : undefined,
              }))
          : [];

      const wantsFreshDigest = Boolean(req.body.fresh);
      const seed = typeof req.body.seed === 'string' || typeof req.body.seed === 'number'
        ? String(req.body.seed)
        : String(Date.now());

      const activeSources = Array.isArray(clientSources) && clientSources.length > 0
        ? clientSources.filter((s: any) => s.status !== 'failing')
        : DEFAULT_FEEDS;

      // 1. Fetch live articles from candidate sources in parallel.
      // A library can hold far more feeds than one run can fetch, so a fresh run rotates
      // through the wider library instead of only ever reading the first ten feeds.
      const MAX_SOURCES_PER_RUN = 14;
      const orderedSources = activeSources.length > MAX_SOURCES_PER_RUN
        ? [...activeSources].sort((a: any, b: any) =>
            stableJitter(seed, String(a.feedUrl || a.id || '')) -
            stableJitter(seed, String(b.feedUrl || b.id || ''))
          )
        : activeSources;
      const runSources = orderedSources.slice(0, MAX_SOURCES_PER_RUN);

      const feedResults = await Promise.allSettled(
        runSources.map((s: any) => fetchFeedWithStatus(s.feedUrl, s.title, s.folder, s.categories))
      );

      const feedFailures: Array<{ title: string; feedUrl?: string; reason: string }> = [];
      let candidatePool: any[] = [];
      runSources.forEach((source: any, index: number) => {
        const result = feedResults[index];
        if (!result || result.status === 'rejected') {
          feedFailures.push({ title: source.title || 'Source', feedUrl: source.feedUrl, reason: 'Request failed' });
          return;
        }
        if (result.value.error) {
          feedFailures.push({ title: source.title || 'Source', feedUrl: source.feedUrl, reason: result.value.error });
        }
        candidatePool.push(...result.value.items);
      });

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
      // Declared interests match whole-word and case-insensitively; category labels are checked
      // exactly first, so a chip named "Art" never fires on "artificial".
      const normalizeInterestLabel = (value: string): string =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9&+]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const matchesInterest = (item: any, label: string): boolean => {
        const needle = normalizeInterestLabel(label);
        if (!needle) return false;
        if (Array.isArray(item.categories) && item.categories.some((category: unknown) => normalizeInterestLabel(String(category || '')) === needle)) return true;
        const haystack = ` ${normalizeInterestLabel(`${item.title || ''} ${item.summary || ''}`)} `;
        return haystack.includes(` ${needle} `);
      };

      // Older votes carry ids but no stored excerpt. Recover the article text from the live
      // pool so the semantic engine has examples to learn from straight away.
      if (feedbackExamples.length < 40 && (moreIds.length > 0 || lessIds.length > 0)) {
        const poolById = new Map<string, any>(candidatePool.map(item => [item.id, item]));
        const knownFeedbackIds = new Set(feedbackExamples.map(entry => entry.id));
        const recover = (ids: string[], vote: 'like' | 'dislike') => {
          ids.forEach(id => {
            if (feedbackExamples.length >= 40 || knownFeedbackIds.has(id)) return;
            const item = poolById.get(id);
            if (!item || !item.title) return;
            knownFeedbackIds.add(id);
            feedbackExamples.push({
              id,
              vote,
              title: String(item.title).slice(0, 300),
              text: `${item.title}\n${item.summary || ''}\n${item.fullText || ''}`.slice(0, 3000),
              timestamp: Date.now(),
              source: item.source,
              folder: item.folder,
            });
          });
        };
        recover(moreIds, 'like');
        recover(lessIds, 'dislike');
      }

      // Downvoted articles are dropped outright. Interest-level "less" chips only down-weight
      // further below, because one broad chip must not be able to empty the digest.
      candidatePool = candidatePool.filter(item => !lessIds.includes(item.id));

      // Freshness: what the browser already showed, so a refresh never repeats itself.
      const recentlyShown: Array<{ id: string; shownAt: number }> = Array.isArray(req.body.recentlyShown)
        ? req.body.recentlyShown
            .filter((entry: any) => entry && typeof entry.id === 'string' && Number.isFinite(entry.shownAt))
            .slice(-200)
            .map((entry: any) => ({ id: entry.id, shownAt: Number(entry.shownAt) }))
        : [];
      const previousDigestIds = new Set<string>(
        Array.isArray(req.body.previousDigestIds)
          ? req.body.previousDigestIds.filter((id: any) => typeof id === 'string')
          : []
      );
      const exposurePenalty = buildExposurePenalty(recentlyShown);

      // A manual refresh keeps the current digest's articles out of the pool when there is room.
      if (wantsFreshDigest && previousDigestIds.size > 0) {
        const withoutPrevious = candidatePool.filter(item => !previousDigestIds.has(item.id));
        if (withoutPrevious.length >= itemCount) {
          candidatePool = withoutPrevious;
        }
      }

      // Provider-free semantic ranking: votes change the digest even with no API key.
      const semanticScores = new Map<string, number>();
      if (feedbackExamples.length > 0 && candidatePool.length > 0) {
        localSemanticScores(feedbackExamples, candidatePool).forEach((value, key) => {
          semanticScores.set(key, value);
        });
      }

      // Optional provider embeddings sharpen those scores; they never silently replace them.
      let providerSemanticMatches = 0;
      const semanticItems = candidatePool.slice(0, 80);
      if (embeddingProvider !== 'none' && feedbackExamples.length > 0 && semanticItems.length > 0) {
        try {
          const feedbackTexts = feedbackExamples.map(entry => `${entry.title}\n${entry.text}`.slice(0, 3200));
          const candidateTexts = semanticItems.map(item =>
            `${item.title || ''}\n${item.folder || ''}\n${Array.isArray(item.categories) ? item.categories.join(' ') : ''}\n${item.summary || ''}\n${item.fullText || ''}`
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 3000)
          );
          const vectors = await embedSemanticTexts([...feedbackTexts, ...candidateTexts], embeddingConfig);
          const positiveCentroid = buildDenseCentroid('like', feedbackExamples, vectors);
          const negativeCentroid = buildDenseCentroid('dislike', feedbackExamples, vectors);
          const candidateVectors = vectors.slice(feedbackExamples.length);

          candidateVectors.forEach((vector, index) => {
            if (!vector) return;
            const positiveSimilarity = positiveCentroid ? cosineSimilarity(vector, positiveCentroid) : 0;
            const negativeSimilarity = negativeCentroid ? cosineSimilarity(vector, negativeCentroid) : 0;
            const providerScore = (positiveSimilarity - negativeSimilarity) / 2;
            const itemId = semanticItems[index]?.id;
            if (!itemId) return;
            const localScore = semanticScores.get(itemId) || 0;
            semanticScores.set(itemId, blendSemanticScores(providerScore, localScore));
            providerSemanticMatches += 1;
          });
        } catch (err: any) {
          console.warn('[Curator] Provider embeddings unavailable, continuing with the built-in semantic engine:', err?.message || err);
        }
      }

      const { scored: scoredPool, deprioritizedIds } = scoreCandidates(candidatePool, {
        seed,
        semanticScores,
        moreIds,
        moreTopics,
        lessTopics,
        readingStats,
        exposurePenalty,
      });

      // Assign a distinct editorial reason per card, in final ranked order.
      scoredPool.forEach((entry: any, index: number) => {
        entry.why = buildWhyLine(entry, index, {
          liked: moreIds.includes(entry.id),
          interest: String(entry._interest || ''),
          semanticScore: Number(entry._semantic) || 0,
        });
      });

      const rankedItems = scoredPool.map(({ _score, _semantic, _interest, _less, ...rest }: any) => rest);

      const distinctSources = new Set(
        rankedItems.map(item => item.source).filter((value): value is string => Boolean(value))
      ).size;
      const maxPerSource = maxPerSourceFor(itemCount, distinctSources);

      const semanticSummary = {
        feedbackExamples: feedbackExamples.length,
        providerVectors: providerSemanticMatches,
        deprioritized: deprioritizedIds.size,
        localEngine: true,
      };

      const feedReport = {
        attempted: runSources.length,
        // The list is capped for the wire; failedCount carries the real number so the
        // "N of M feeds" line never under-reports a wide outage.
        failed: feedFailures.slice(0, 12),
        failedCount: feedFailures.length,
      };

      // 2. Curate using AI if requested and candidate pool is ready
      if (provider !== 'deterministic' && candidatePool.length >= 4) {
        const candidatesForAi = scoredPool.slice(0, 30).map((item: any, idx: number) => ({
          idx,
          id: item.id,
          title: item.title,
          source: item.source,
          folder: item.folder,
          categories: item.categories,
          summary: item.summary,
          readTime: item.readTime,
          isLiked: moreIds.includes(item.id),
          matchesPreferredTopic: Boolean(item._interest),
          matchesLessTopic: Boolean(item._less),
          semanticScore: Number((item._semantic || 0).toFixed(3))
        }));

        const prompt = `You are a sophisticated personal reading editor. Your task is to curate a daily reading digest of exactly ${itemCount} items by selecting the best articles from the live candidate pool below based on the user's signals and serendipity setting (${serendipityDial}%).

Live Candidate Articles:
${JSON.stringify(candidatesForAi)}

User Reading Preferences:
- Prioritized Topics (MORE): ${JSON.stringify(moreTopics)}
- De-emphasized Topics (LESS): ${JSON.stringify(lessTopics)}
- Candidate isLiked and matchesPreferredTopic flags reflect exact article/topic feedback; matchesLessTopic marks a topic the reader asked for less of.
- semanticScore is a relevance score built from your recent positive minus negative article votes (Curator's built-in semantic engine, plus your embeddings provider when configured); higher values are a better match.
- Articles thumbs-up: ${JSON.stringify(moreIds)}
- Articles thumbs-down: ${JSON.stringify(lessIds)} (exact downvoted articles and any legacy less topics are already excluded)
Serendipity Dial: ${serendipityDial}% (0% = stay close to established interests; 100% = stretch into unfamiliar intellectual territories).

CURATION RULES:
1. Select exactly ${itemCount} unique items from the candidate pool using their "idx".
2. Strongly prioritize candidates marked isLiked, matchesPreferredTopic, or with higher semanticScore; avoid candidates marked matchesLessTopic and negative semanticScore candidates when similar alternatives exist.
3. At least 1 (or 2 if serendipity >= 40) should be an "isOutOfBubble": true stretch item from a folder different from the user's top interests.
4. For each selected item, write a 1-sentence editorial "why" rationale explaining why this piece was selected (e.g. "Selected for your reading interest in Economics", "A thoughtful design retrospective", "Deliberate stretch: outside your usual tech routine").
5. Candidates are already ordered by publication recency, topic fit and semantic match, and pieces shown in recent digests are down-ranked. Prefer items nearer the top of the list.
6. Return ONLY a JSON array of objects with keys: "idx" (number), "why" (string), "isOutOfBubble" (boolean).`;

        let aiSelections: Array<{ idx: number; why: string; isOutOfBubble: boolean }> | null = null;

        if (provider === 'openai-compatible' && clientApiKey.trim() && clientBaseUrl && clientModel) {
          try {
            const parsed = await callOpenAICompatible({
              apiKey: clientApiKey.trim(),
              baseUrl: clientBaseUrl,
              model: clientModel,
            }, prompt);
            const list = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.selections || parsed?.digest);
            if (Array.isArray(list) && list.length > 0) aiSelections = list;
          } catch (e: any) {
            console.warn('[Curator] OpenAI-compatible curation failed, falling back:', e.message);
          }
        } else if (provider === 'anthropic' && clientApiKey.trim()) {
          try {
            const parsed = await callAnthropic(clientApiKey.trim(), prompt, clientModel || 'claude-3-5-sonnet-20241022');
            const list = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.selections || parsed?.digest);
            if (Array.isArray(list) && list.length > 0) aiSelections = list;
          } catch (e: any) {
            console.warn('[Curator] Anthropic curation failed, falling back:', e.message);
          }
        } else if (provider === 'gemini') {
          const activeAi = clientApiKey.trim()
            ? new GoogleGenAI({ apiKey: clientApiKey.trim(), httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
            : ai;

          if (activeAi) {
            try {
              const response = await activeAi.models.generateContent({
                model: clientModel || 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
              });
              recordGeminiUsage(response);
              if (response.text) {
                const parsed = parseModelJson(response.text);
                const list = Array.isArray(parsed) ? parsed : (parsed?.items || parsed?.selections || parsed?.digest);
                if (Array.isArray(list) && list.length > 0) aiSelections = list;
              }
            } catch (err: any) {
              console.warn('[Curator] Gemini curation failed:', err.message);
            }
          }
        }

        if (aiSelections && aiSelections.length > 0) {
          const chosenArticles: any[] = [];
          const usedIdx = new Set<number>();
          for (const sel of aiSelections) {
            const idx = Number(sel?.idx);
            const entry = scoredPool[idx];
            if (!entry || usedIdx.has(idx)) continue;
            usedIdx.add(idx);
            const { _score, _semantic, ...rest } = entry;
            chosenArticles.push({
              ...rest,
              why: typeof sel.why === 'string' && sel.why.trim() ? sel.why : rest.why,
              isOutOfBubble: Boolean(sel.isOutOfBubble)
            });
          }

          const aiDigest = selectDiverse(rankedItems, itemCount, maxPerSource, chosenArticles);
          if (aiDigest.length >= Math.min(itemCount, Math.max(1, candidatePool.length))) {
            const enrichedDigest = await enrichSelectedArticles(aiDigest);
            return res.json({ digest: enrichedDigest, generatedByAI: true, semanticSummary, feedReport });
          }
        }
      }

      const digest = buildDeterministicDigest(rankedItems, {
        itemCount,
        serendipityDial,
        maxPerSource,
        likedFeedback: feedbackExamples,
      });
      const enrichedDigest = await enrichSelectedArticles(digest);

      res.json({ digest: enrichedDigest, generatedByAI: false, semanticSummary, feedReport });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate digest' });
    }
  });

  // Calibration pool for the setup wizard: a spread of recent articles to vote on
  app.post('/api/calibrate', rateLimit('calibrate', 12), async (req, res) => {
    try {
      const { sources: clientSources, excludeIds } = req.body;
      const activeSources = Array.isArray(clientSources) && clientSources.length > 0
        ? clientSources.filter((s: any) => s.status !== 'failing')
        : DEFAULT_FEEDS;

      const seed = String(Date.now());
      const ordered = activeSources.length > 14
        ? [...activeSources].sort((a: any, b: any) =>
            stableJitter(seed, String(a.feedUrl || a.id || '')) -
            stableJitter(seed, String(b.feedUrl || b.id || ''))
          )
        : activeSources;

      const feedResults = await Promise.allSettled(
        ordered.slice(0, 14).map((s: any) => fetchFeedArticles(s.feedUrl, s.title, s.folder, s.categories))
      );

      const excluded = new Set<string>(
        Array.isArray(excludeIds) ? excludeIds.filter((id: any) => typeof id === 'string') : []
      );

      let pool: any[] = [];
      for (const result of feedResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          pool.push(...result.value);
        }
      }

      const seen = new Set<string>();
      pool = pool
        .filter(item => {
          if (!item || !item.id || !item.title) return false;
          if (excluded.has(item.id) || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        })
        .sort((a, b) => {
          const left = Number(a.publishedAtMs);
          const right = Number(b.publishedAtMs);
          return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
        });

      const perSource = new Map<string, number>();
      const candidates: any[] = [];
      for (const item of pool) {
        if (candidates.length >= 12) break;
        const key = item.source || 'Unknown';
        const used = perSource.get(key) || 0;
        if (used >= 2) continue;
        perSource.set(key, used + 1);
        candidates.push({
          id: item.id,
          title: item.title,
          source: item.source,
          sourceDescription: item.sourceDescription,
          folder: item.folder,
          categories: item.categories,
          summary: item.summary,
          readTime: item.readTime,
          url: item.url,
          fullText: String(item.fullText || '').slice(0, 1500),
          publishedAt: item.publishedAt,
          bannerImage: item.bannerImage,
          isOutOfBubble: false,
          why: 'Calibration sample',
        });
      }

      if (candidates.length === 0) {
        return res.status(404).json({ error: 'No live articles were available to calibrate with.' });
      }

      res.json({ candidates });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Could not build a calibration list' });
    }
  });

  // Comprehensive multi-source live feed stream endpoint
  // Adding a source now proves the URL serves a feed before the reader is told it worked.
  app.post('/api/check-feed', rateLimit('check-feed', 30), async (req, res) => {
    const feedUrl = String(req.body?.feedUrl || '').trim();
    if (!feedUrl) {
      res.status(400).json({ ok: false, error: 'No feed URL given' });
      return;
    }
    try {
      const result = await fetchFeedWithStatus(feedUrl, 'New source', 'General');
      if (result.error) {
        res.status(200).json({ ok: false, error: result.error });
        return;
      }
      if (result.items.length === 0) {
        res.status(200).json({ ok: false, error: 'That address answered, but it contained no readable stories' });
        return;
      }
      res.json({ ok: true, itemCount: result.items.length, title: result.items[0]?.source || null });
    } catch (error: any) {
      res.status(200).json({ ok: false, error: error?.message || 'That address could not be read' });
    }
  });

  // A piece saved before the cleaner kept inline links has only the link's words left in its
  // stored text, so the reader can ask for the article once more and replace that copy. The
  // extractor and its 24-hour cache are the ones curation already uses, so a story fetched for
  // the digest costs nothing here.
  app.post('/api/article-text', rateLimit('article-text', 60), async (req, res) => {
    const target = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 2000) : '';
    res.setHeader('Cache-Control', 'no-store');
    if (!target) {
      res.status(400).json({ error: 'A url is required' });
      return;
    }
    try {
      const text = await fetchArticleBody(target);
      res.json({ text: text || '' });
    } catch {
      res.status(200).json({ text: '' });
    }
  });

  // The saved queue is upgraded in one pass, so a piece the reader never reopens still gets its
  // citations back. Each story runs through the same extractor and cache as the single-piece
  // route; four at a time keeps a long queue inside one request without hammering publishers.
  app.post('/api/article-texts', rateLimit('article-texts', 20), requestBudget('Adding citations', 55_000), async (req, res) => {
    const requested = Array.isArray(req.body?.items) ? req.body.items.slice(0, 16) : [];
    const articles: Array<{ id: string; text: string }> = [];
    let nextIndex = 0;
    const workerCount = Math.min(4, requested.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < requested.length) {
        const entry = requested[nextIndex++];
        const id = typeof entry?.id === 'string' ? entry.id.slice(0, 200) : '';
        const target = typeof entry?.url === 'string' ? entry.url.trim().slice(0, 2000) : '';
        if (!id || !target) continue;
        let text = '';
        try {
          text = (await fetchArticleBody(target)) || '';
        } catch {
          // A story that cannot be read now keeps its stored body and can be retried later.
        }
        articles.push({ id, text });
      }
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ articles });
  });

  app.post('/api/feed-stream', async (req, res) => {
    try {
      const { sourceTitle, sourceId, sources: clientSources, refreshAll, force } = req.body || {};
      const allSources = Array.isArray(clientSources) && clientSources.length > 0
        ? clientSources
        : DEFAULT_FEEDS;

      const requestedTitle = typeof sourceTitle === 'string' ? sourceTitle.trim() : '';
      const wantsOneSource = Boolean(requestedTitle) && requestedTitle.toLowerCase() !== 'all';
      // A refresh means "re-read the network", so it skips the five-minute feed cache.
      const refreshingEverything = refreshAll === true;
      const forceNetwork = refreshingEverything || force === true;

      let targetFeeds: Array<{ id?: string; title: string; feedUrl: string; folder: string; categories?: string[] }> = [];
      // When one source is on screen, narrow the response to it even if every feed was re-read.
      let visibleTitles: Set<string> | null = null;

      if (wantsOneSource) {
        const queryNorm = requestedTitle.toLowerCase();
        const matched = allSources.filter((s: any) =>
          (sourceId && String(s.id || '') === String(sourceId)) ||
          String(s.id || '') === requestedTitle ||
          String(s.title || '').toLowerCase() === queryNorm ||
          String(s.title || '').toLowerCase().includes(queryNorm) ||
          queryNorm.includes(String(s.title || '').toLowerCase())
        );
        if (matched.length > 0) {
          targetFeeds = refreshingEverything ? allSources.filter((s: any) => s?.feedUrl) : matched;
          if (refreshingEverything) {
            visibleTitles = new Set(matched.map((s: any) => String(s.title || '').toLowerCase()));
          }
        } else {
          const defMatch = DEFAULT_FEEDS.filter(s =>
            s.title.toLowerCase().includes(queryNorm) || queryNorm.includes(s.title.toLowerCase())
          );
          targetFeeds = defMatch.length > 0 ? defMatch : [{ title: requestedTitle, feedUrl: '', folder: 'Custom Feed' }];
        }
      } else if (refreshingEverything) {
        // Every watched feed: including the ones marked failing and any past the 24-feed slice
        // the plain stream draws from. A refresh is meant to re-read the whole library.
        targetFeeds = allSources.filter((s: any) => s?.feedUrl);
      } else {
        targetFeeds = allSources.filter((s: any) => s.status !== 'failing').slice(0, 24);
      }

      const results = await Promise.allSettled(
        targetFeeds.map(f => fetchFeedWithStatus(f.feedUrl, f.title, f.folder, f.categories, { force: forceNetwork }))
      );

      let articles: any[] = [];
      // One row per feed, so the client can mark exactly the sources that answered.
      const feedResults = targetFeeds.map((feed, index) => {
        const result = results[index];
        const items = result.status === 'fulfilled' && Array.isArray(result.value.items) ? result.value.items : [];
        articles.push(...items);
        const error = result.status === 'rejected'
          ? (result.reason?.message || 'Feed could not be reached')
          : result.value.error;
        const ok = items.length > 0;
        return {
          id: feed.id,
          title: feed.title,
          feedUrl: feed.feedUrl,
          ok,
          itemCount: items.length,
          error: ok ? undefined : (error || 'This feed returned no articles.'),
        };
      });

      // The starter-library fallback only belongs to the "all feeds" stream: a single source
      // with nothing to show must not be filled with other publications' articles.
      if (articles.length === 0 && !refreshingEverything && !wantsOneSource) {
        const defResults = await Promise.allSettled(
          DEFAULT_FEEDS.slice(0, 4).map(f => fetchFeedArticles(f.feedUrl, f.title, f.folder))
        );
        for (const r of defResults) {
          if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            articles.push(...r.value);
          }
        }
      }

      if (visibleTitles) {
        articles = articles.filter(article => visibleTitles!.has(String(article?.source || '').toLowerCase()));
      }

      // Feeds arrive in parallel, so the merged list would otherwise be grouped by source
      // rather than the newest-first order the stream promises.
      articles.sort((a: any, b: any) => {
        const left = Number(a?.publishedAtMs);
        const right = Number(b?.publishedAtMs);
        return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0);
      });

      res.json({
        success: true,
        source: requestedTitle || 'all',
        total: articles.length,
        articles,
        sources: feedResults,
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
  app.post('/api/discover-sources', rateLimit('discover-sources', 6), requestBudget('Source discovery', 45_000), async (req, res) => {
    try {
      const { query, apiKey: clientApiKey } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ error: 'Search terms are required.' });
      }

      const trimmedClientKey = typeof clientApiKey === 'string' ? clientApiKey.trim() : '';

      // Only a caller-supplied key may spend on discovery: this route is public and every
      // grounded search bills the key it runs on. The operator's key is opt-in via
      // ALLOW_SERVER_KEY=1; without a key the curated directory answers instead.
      const discoveryAi = trimmedClientKey
        ? new GoogleGenAI({ apiKey: trimmedClientKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' } } })
        : ALLOW_SERVER_KEY
          ? ai
          : null;

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
            model: process.env.GEMINI_DISCOVERY_MODEL || 'gemini-2.5-flash',
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
            },
          });
          recordGeminiUsage(response);

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
        // Lets the client (and a test) tell a grounded search from the built-in directory
        aiAssisted: Boolean(discoveryAi),
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

  if (process.env.NODE_ENV === 'production') {
    // Serve the client built by `npm run build` instead of mounting the dev middleware
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  } else {
    // Vite middleware for development (HMR disabled in cloud iframe to prevent WebSocket closed errors)
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      }
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
