import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import path from 'path';

dotenv.config();

// Outbound fetch hardening: only public http(s) hosts, re-checked on every redirect hop
const MAX_REDIRECTS = 4;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

class BlockedUrlError extends Error {}

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

// ---------------------------------------------------------------------------
// Provider-agnostic semantic engine.
// Runs on the feed text itself with no API key, so votes always change ranking.
// Provider embeddings, when configured, are blended on top of these scores.
// ---------------------------------------------------------------------------

interface SemanticVoteExample {
  id: string;
  vote: 'like' | 'dislike';
  title: string;
  text: string;
  timestamp: number;
  source?: string;
  folder?: string;
}

interface SemanticCandidate {
  id: string;
  title?: string;
  summary?: string;
  fullText?: string;
  folder?: string;
  source?: string;
}

const SEMANTIC_STOPWORDS = new Set(
  (`a about above after again against all also although am an and any are as at be because been before being below
   between both but by can could did do does doing down during each either few first for from further had has have
   having he her here hers herself him himself his how i if in into is it its itself just like made make many may me
   might more most much must my myself new no nor not now of off often on once one only or other our ours ourselves
   out over own same she should since so some such than that the their theirs them themselves then there these they
   this those through thus to too under until up upon very was we were what when where whether which while who whom
   why will with within without would you your yours yourself yourselves`).split(/\s+/)
);

const semanticTokens = (text: string): string[] => {
  const stripped = (text || '')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase();
  const raw = stripped.match(/[a-z][a-z'-]{2,}/g) || [];
  const tokens: string[] = [];
  for (const token of raw) {
    if (SEMANTIC_STOPWORDS.has(token)) continue;
    tokens.push(token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token);
  }
  return tokens;
};

const semanticTermCounts = (text: string): Map<string, number> => {
  const tokens = semanticTokens(text);
  const counts = new Map<string, number>();
  const bump = (term: string, amount: number) => {
    if (!term) return;
    counts.set(term, (counts.get(term) || 0) + amount);
  };
  tokens.forEach((token, index) => {
    bump(token, 1);
    const next = tokens[index + 1];
    if (next) bump(`${token}_${next}`, 0.5);
  });
  return counts;
};

const composeSemanticText = (item: SemanticCandidate): string => {
  const title = item.title || '';
  const folder = item.folder || '';
  const summary = item.summary || '';
  const full = String(item.fullText || '').slice(0, 1800);
  return `${title}. ${title}. ${title}. ${folder}. ${folder}. ${summary}. ${summary}. ${full}`;
};

const buildSemanticVectors = (documents: string[]): Array<Map<string, number>> => {
  const counts = documents.map(semanticTermCounts);
  const documentFrequency = new Map<string, number>();
  counts.forEach(terms => {
    terms.forEach((_value, term) => {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    });
  });
  const total = Math.max(1, documents.length);

  return counts.map(terms => {
    const vector = new Map<string, number>();
    let magnitude = 0;
    terms.forEach((value, term) => {
      const frequency = documentFrequency.get(term) || 1;
      const weight = value * Math.log(1 + total / frequency);
      if (weight <= 0) return;
      vector.set(term, weight);
      magnitude += weight * weight;
    });
    const norm = Math.sqrt(magnitude);
    if (norm > 0) {
      vector.forEach((value, term) => vector.set(term, value / norm));
    }
    return vector;
  });
};

const sparseCosine = (left: Map<string, number>, right: Map<string, number>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  small.forEach((value, term) => {
    const other = large.get(term);
    if (other) dot += value * other;
  });
  return dot;
};

const buildSparseCentroid = (
  vote: 'like' | 'dislike',
  examples: SemanticVoteExample[],
  vectors: Array<Map<string, number> | null>,
): Map<string, number> | null => {
  const halfLifeMs = 60 * 24 * 60 * 60 * 1000;
  const centroid = new Map<string, number>();
  let totalWeight = 0;

  examples.forEach((example, index) => {
    if (example.vote !== vote) return;
    const vector = vectors[index];
    if (!vector) return;
    const ageMs = Math.max(0, Date.now() - example.timestamp);
    const weight = Math.pow(0.5, ageMs / halfLifeMs);
    vector.forEach((value, term) => centroid.set(term, (centroid.get(term) || 0) + value * weight));
    totalWeight += weight;
  });

  if (totalWeight === 0 || centroid.size === 0) return null;
  let magnitude = 0;
  centroid.forEach(value => { magnitude += value * value; });
  if (magnitude <= 0) return null;
  const norm = Math.sqrt(magnitude);
  centroid.forEach((value, term) => centroid.set(term, value / norm));
  return centroid;
};

const localSemanticScores = (
  feedback: SemanticVoteExample[],
  candidates: SemanticCandidate[],
): Map<string, number> => {
  const scores = new Map<string, number>();
  if (feedback.length === 0 || candidates.length === 0) return scores;

  const candidateTexts = candidates.map(composeSemanticText);
  const feedbackTexts = feedback.map(entry => `${entry.title}. ${entry.title}. ${entry.title}. ${entry.text}`);
  const vectors = buildSemanticVectors([...candidateTexts, ...feedbackTexts]);
  const feedbackVectors = vectors.slice(candidates.length);

  const positive = buildSparseCentroid('like', feedback, feedbackVectors);
  const negative = buildSparseCentroid('dislike', feedback, feedbackVectors);
  if (!positive && !negative) return scores;

  vectors.slice(0, candidates.length).forEach((vector, index) => {
    const candidate = candidates[index];
    if (!candidate || !candidate.id) return;
    const positiveSimilarity = positive ? sparseCosine(vector, positive) : 0;
    const negativeSimilarity = negative ? sparseCosine(vector, negative) : 0;
    const score = positive && negative
      ? (positiveSimilarity - negativeSimilarity) / 2
      : positive
        ? positiveSimilarity
        : -negativeSimilarity;
    if (Number.isFinite(score)) scores.set(candidate.id, score);
  });

  return scores;
};

// Recency from the feed's own publication date, falling back to a neutral value.
const recencyWeight = (item: { publishedAtMs?: number }): number => {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return 0.45;
  const ageDays = Math.max(0, (Date.now() - published) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 5);
};

// How fresh an article is, in words, for the editorial "why" line.
const recencyPhrase = (item: { publishedAtMs?: number }): string => {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return '';
  const ageHours = Math.max(0, (Date.now() - published) / (60 * 60 * 1000));
  if (ageHours <= 24) return 'today';
  if (ageHours <= 96) return 'this week';
  if (ageHours <= 24 * 21) return 'this month';
  return '';
};

// A distinct, specific "why" per card: reason first, then a rotating phrasing so a digest
// drawn from one dominant feed does not repeat the same sentence on every card.
const buildWhyLine = (
  item: any,
  index: number,
  context: { liked: boolean; preferredTopic: boolean; semanticScore: number },
): string => {
  const source = String(item.source || 'your feeds').trim();
  const folder = String(item.folder || '').trim();
  const ageLabel = recencyPhrase(item);

  if (context.liked) {
    return `Selected for your reading interest in ${folder || source}.`;
  }
  if (context.preferredTopic) {
    return `Selected because you keep returning to ${folder || source}.`;
  }
  if (context.semanticScore > 0.28) {
    return 'A close match to the pieces you have been upvoting.';
  }
  if (context.semanticScore > 0.12) {
    return 'Shares the shape of articles you liked lately.';
  }

  const variants = folder
    ? [
        `New ${ageLabel || 'recently'} from ${source} · ${folder}.`,
        `${folder} from ${source}, not yet on your shelf.`,
        `From ${source}, filed under ${folder} — new to you.`,
        `${source} on ${folder} — a fresh corner of your library.`,
      ]
    : [
        `New ${ageLabel || 'recently'} from ${source}.`,
        `From ${source}, not yet on your shelf.`,
        `Fresh from ${source}, outside your last digest.`,
        `${source} — new to this digest.`,
      ];

  return variants[index % variants.length];
};

// Stable per-seed tie-breaker so a refresh reshuffles ties without shuffling mid-read.
const stableJitter = (seed: string, id: string): number => {
  let hash = 2166136261;
  const input = `${seed}|${id}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
};

// Greedy selection that avoids one prolific feed taking over the whole digest.
const selectDiverse = (
  ranked: any[],
  count: number,
  maxPerSource: number,
  priority: any[] = [],
): any[] => {
  if (count <= 0) return [];
  const chosen: any[] = [];
  const usedIds = new Set<string>();
  const perSource = new Map<string, number>();

  const add = (item: any, enforceCap: boolean) => {
    if (chosen.length >= count || !item || !item.id || usedIds.has(item.id)) return;
    const key = item.source || 'Unknown';
    if (enforceCap && (perSource.get(key) || 0) >= maxPerSource) return;
    usedIds.add(item.id);
    perSource.set(key, (perSource.get(key) || 0) + 1);
    chosen.push(item);
  };

  priority.forEach(item => add(item, true));
  ranked.forEach(item => add(item, true));
  if (chosen.length < count) ranked.forEach(item => add(item, false));
  return chosen.slice(0, count);
};

async function callOpenAICompatible(config: ProviderRequestConfig, prompt: string): Promise<any> {
  const data = await postProviderJson(
    providerEndpoint(config.baseUrl, 'chat/completions'),
    { Authorization: `Bearer ${config.apiKey}` },
    { model: config.model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 },
  );
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('')
      : '';
  if (!text) throw new Error('AI provider returned no message content.');
  return parseModelJson(text);
}

async function callAnthropic(apiKey: string, prompt: string, model: string): Promise<any> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error: ${resp.status} ${errText}`);
  }
  const data = await resp.json();
  const text = data.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('Anthropic returned no message content.');
  return parseModelJson(text);
}

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
  app.use(express.json({ limit: '25mb' }));

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
  const vectorSimilarity = (left: number[], right: number[]): number => {
    if (left.length !== right.length || left.length === 0) return 0;
    return left.reduce((sum, value, index) => sum + value * right[index], 0);
  };
  const buildFeedbackCentroid = (
    vote: 'like' | 'dislike',
    examples: Array<{ vote: 'like' | 'dislike'; timestamp: number }>,
    embeddings: Array<number[] | null>,
  ): number[] | null => {
    let centroid: number[] = [];
    let totalWeight = 0;
    const halfLifeMs = 90 * 24 * 60 * 60 * 1000;

    examples.forEach((example, index) => {
      const vector = embeddings[index];
      if (example.vote !== vote || !vector) return;
      if (centroid.length === 0) centroid = Array(vector.length).fill(0);
      if (centroid.length !== vector.length) return;
      const ageMs = Math.max(0, Date.now() - example.timestamp);
      const weight = Math.pow(0.5, ageMs / halfLifeMs);
      vector.forEach((value, dimension) => {
        centroid[dimension] += value * weight;
      });
      totalWeight += weight;
    });

    if (totalWeight === 0) return null;
    const magnitude = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? centroid.map(value => value / magnitude) : null;
  };

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
        vectors = (response.embeddings || []).map(item => item?.values);
      } else {
        const response = await postProviderJson(
          providerEndpoint(baseUrl, 'embeddings'),
          { Authorization: `Bearer ${apiKey}` },
          { model, input: batch.map(item => item.text) },
        );
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

  // API Routes
  app.get('/api/semantic-status', (_req, res) => {
    res.json({
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY),
      localEngine: true,
    });
  });

  // OPML Parser endpoint
  app.post('/api/parse-opml', (req, res) => {
    try {
      const { opmlText } = req.body;
      if (!opmlText || typeof opmlText !== 'string' || !opmlText.trim()) {
        return res.status(400).json({ error: 'No OPML content provided' });
      }

      const decodeXml = (str: string) =>
        str
          .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value: string) => {
            const codePoint = value[0].toLowerCase() === 'x'
              ? parseInt(value.slice(1), 16)
              : parseInt(value, 10);
            return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
              !(codePoint >= 0xd800 && codePoint <= 0xdfff)
              ? String.fromCodePoint(codePoint)
              : entity;
          })
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

      // Scan outline tags without treating a '>' inside a quoted attribute as the end of a tag.
      const outlineTags: string[] = [];
      let cursor = 0;
      while ((cursor = opmlText.indexOf('<', cursor)) !== -1) {
        if (opmlText.startsWith('<!--', cursor)) {
          const commentEnd = opmlText.indexOf('-->', cursor + 4);
          cursor = commentEnd === -1 ? opmlText.length : commentEnd + 3;
          continue;
        }
        if (opmlText.startsWith('<![CDATA[', cursor)) {
          const cdataEnd = opmlText.indexOf(']]>', cursor + 9);
          cursor = cdataEnd === -1 ? opmlText.length : cdataEnd + 3;
          continue;
        }
        if (opmlText.startsWith('<!', cursor) || opmlText.startsWith('<?', cursor)) {
          const declarationEnd = opmlText.indexOf('>', cursor + 2);
          cursor = declarationEnd === -1 ? opmlText.length : declarationEnd + 1;
          continue;
        }

        const remainder = opmlText.slice(cursor);
        const closingTag = remainder.match(/^<\/(?:[\w.-]+:)?outline\s*>/i);
        if (closingTag) {
          outlineTags.push(closingTag[0]);
          cursor += closingTag[0].length;
          continue;
        }

        const openingTag = remainder.match(/^<(?:[\w.-]+:)?outline(?=[\s/>])/i);
        if (!openingTag) {
          cursor += 1;
          continue;
        }

        let end = cursor + openingTag[0].length;
        let quote: string | null = null;
        for (; end < opmlText.length; end += 1) {
          const char = opmlText[end];
          if (quote) {
            if (char === quote) quote = null;
          } else if (char === '"' || char === "'") {
            quote = char;
          } else if (char === '>') {
            break;
          }
        }
        if (end >= opmlText.length) break;

        outlineTags.push(opmlText.slice(cursor, end + 1));
        cursor = end + 1;
      }

      const folderStack: string[] = [];
      let foundAnyOutline = false;

      for (const tag of outlineTags) {
        foundAnyOutline = true;

        if (/^<\/(?:[\w.-]+:)?outline/i.test(tag)) {
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

  // Feeds mix named and numeric XML entities; anything left undecoded renders as "&amp;#8217;"
  // style noise in the reader, so decode both, then the literal ampersand last.
  const decodeEntities = (str: string): string =>
    str
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

  const cleanHtml = (str: string): string => {
    if (!str) return '';
    return decodeEntities(
      str
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Paragraph-shaped plain text for the reader: real paragraphs, no stray lines,
  // no promo/repeated boilerplate, no unicode debris.
  const htmlToReadableText = (html: string): string => {
    if (!html) return '';

    const stripped = html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|blockquote|section|article)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ');

    const decoded = decodeEntities(stripped);

    return decoded
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/([,.;:!?])(?=[A-Za-z0-9“"'(])/g, '$1 ')
      .replace(/\n{3,}/g, '\n\n')
      .split(/\n{2,}/)
      .map(paragraph => {
        let next = paragraph
          .replace(/\s*\n\s*/g, ' ')
          .replace(/\s+([,.;:!?])/g, '$1')
          .replace(/\s{2,}/g, ' ')
          .trim();
        // A stripped inline link can leave a paragraph starting with the punctuation that followed it.
        if (/^[,;:.]/.test(next)) {
          next = next.replace(/^[,;:.]+\s*/, '');
          next = next.charAt(0).toUpperCase() + next.slice(1);
        }
        return next;
      })
      .filter(paragraph => paragraph.length > 0 && /[\p{L}\p{N}]/u.test(paragraph))
      .filter(paragraph => !(paragraph.length < 180 && /^(click here|subscribe|sign up|follow me|read more|share this|advertisement)\b/i.test(paragraph)))
      .filter(paragraph => !/^the post .+ appeared first on /i.test(paragraph))
      .join('\n\n');
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
      const publishedAt = formatPublishDate(rawDate);
      const publishedAtMs = rawDate ? new Date(rawDate).getTime() : NaN;

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
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : undefined,
        bannerImage,
        isOutOfBubble: false,
        why: `From your ${sourceTitle} subscription.`
      });
    }
    return items;
  };

  const fetchFeedWithStatus = async (
    feedUrl: string,
    sourceTitle: string,
    folder: string,
  ): Promise<{ items: any[]; error?: string }> => {
    if (!feedUrl) return { items: [], error: 'No feed URL set' };
    const cached = feedCache.get(feedUrl);
    if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL) {
      return { items: cached.items };
    }
    try {
      const page = await fetchPublicPage(feedUrl, 7000);
      if (page && page.ok && page.text) {
        const parsed = parseFeedItems(page.text, sourceTitle, folder, feedUrl);
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

  const fetchFeedArticles = async (feedUrl: string, sourceTitle: string, folder: string): Promise<any[]> =>
    (await fetchFeedWithStatus(feedUrl, sourceTitle, folder)).items;

  // Curate daily digest from live feeds using configured provider adapters or deterministic ranking
  app.post('/api/curate', async (req, res) => {
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
        runSources.map((s: any) => fetchFeedWithStatus(s.feedUrl, s.title, s.folder))
      );

      const feedFailures: Array<{ title: string; reason: string }> = [];
      let candidatePool: any[] = [];
      runSources.forEach((source: any, index: number) => {
        const result = feedResults[index];
        if (!result || result.status === 'rejected') {
          feedFailures.push({ title: source.title || 'Source', reason: 'Request failed' });
          return;
        }
        if (result.value.error) {
          feedFailures.push({ title: source.title || 'Source', reason: result.value.error });
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

      // Apply explicit negative feedback before either AI or deterministic curation.
      candidatePool = candidatePool.filter(item =>
        !lessIds.includes(item.id) && !matchesTopicSignal(item, lessTopics)
      );

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
      const nowMs = Date.now();
      const exposurePenalty = new Map<string, number>();
      const deprioritizedIds = new Set<string>();
      recentlyShown.forEach(entry => {
        const ageHours = Math.max(0, (nowMs - entry.shownAt) / (60 * 60 * 1000));
        const penalty = ageHours < 18 ? 65 : ageHours < 72 ? 28 : ageHours < 336 ? 8 : 0;
        if (penalty > 0) {
          exposurePenalty.set(entry.id, Math.max(exposurePenalty.get(entry.id) || 0, penalty));
        }
      });

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
            `${item.title || ''}\n${item.summary || ''}\n${item.fullText || ''}`
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 3000)
          );
          const vectors = await embedSemanticTexts([...feedbackTexts, ...candidateTexts], embeddingConfig);
          const positiveCentroid = buildFeedbackCentroid('like', feedbackExamples, vectors);
          const negativeCentroid = buildFeedbackCentroid('dislike', feedbackExamples, vectors);
          const candidateVectors = vectors.slice(feedbackExamples.length);

          candidateVectors.forEach((vector, index) => {
            if (!vector) return;
            const positiveSimilarity = positiveCentroid ? vectorSimilarity(vector, positiveCentroid) : 0;
            const negativeSimilarity = negativeCentroid ? vectorSimilarity(vector, negativeCentroid) : 0;
            const providerScore = (positiveSimilarity - negativeSimilarity) / 2;
            const itemId = semanticItems[index]?.id;
            if (!itemId) return;
            const localScore = semanticScores.get(itemId) || 0;
            semanticScores.set(itemId, providerScore * 0.65 + localScore * 0.35);
            providerSemanticMatches += 1;
          });
        } catch (err: any) {
          console.warn('[Curator] Provider embeddings unavailable, continuing with the built-in semantic engine:', err?.message || err);
        }
      }

      const scoredPool = candidatePool
        .map((item: any) => {
          const semanticScore = semanticScores.get(item.id) || 0;
          const liked = moreIds.includes(item.id);
          const preferredTopic = matchesTopicSignal(item, moreTopics);
          const penalty = exposurePenalty.get(item.id) || 0;
          if (penalty > 0) deprioritizedIds.add(item.id);

          let score = recencyWeight(item) * 45
            + semanticScore * 120
            + stableJitter(seed, item.id) * 12
            - penalty;
          if (liked) score += 30;
          if (preferredTopic) score += 15;
          if (readingStats && readingStats[item.id]?.finished) score += 8;

          return { ...item, isOutOfBubble: false, _score: score, _semantic: semanticScore };
        })
        .sort((a, b) => b._score - a._score);

      // Assign a distinct editorial reason per card, in final ranked order.
      scoredPool.forEach((entry: any, index: number) => {
        entry.why = buildWhyLine(entry, index, {
          liked: moreIds.includes(entry.id),
          preferredTopic: matchesTopicSignal(entry, moreTopics),
          semanticScore: Number(entry._semantic) || 0,
        });
      });

      const rankedItems = scoredPool.map(({ _score, _semantic, ...rest }: any) => rest);

      const distinctSources = new Set(
        rankedItems.map(item => item.source).filter((value): value is string => Boolean(value))
      ).size;
      const maxPerSource = Math.max(
        2,
        Math.min(itemCount, Math.ceil(itemCount / Math.max(1, distinctSources)))
      );

      const semanticSummary = {
        feedbackExamples: feedbackExamples.length,
        providerVectors: providerSemanticMatches,
        deprioritized: deprioritizedIds.size,
        localEngine: true,
      };

      const feedReport = {
        attempted: runSources.length,
        failed: feedFailures.slice(0, 12),
      };

      // 2. Curate using AI if requested and candidate pool is ready
      if (provider !== 'deterministic' && candidatePool.length >= 4) {
        const candidatesForAi = scoredPool.slice(0, 30).map((item: any, idx: number) => ({
          idx,
          id: item.id,
          title: item.title,
          source: item.source,
          folder: item.folder,
          summary: item.summary,
          readTime: item.readTime,
          isLiked: moreIds.includes(item.id),
          matchesPreferredTopic: matchesTopicSignal(item, moreTopics),
          semanticScore: Number((item._semantic || 0).toFixed(3))
        }));

        const prompt = `You are a sophisticated personal reading editor. Your task is to curate a daily reading digest of exactly ${itemCount} items by selecting the best articles from the live candidate pool below based on the user's signals and serendipity setting (${serendipityDial}%).

Live Candidate Articles:
${JSON.stringify(candidatesForAi)}

User Reading Preferences:
- Prioritized Topics (MORE): ${JSON.stringify(moreTopics)}
- De-emphasized Topics (LESS): ${JSON.stringify(lessTopics)}
- Candidate isLiked and matchesPreferredTopic flags reflect exact article/topic feedback.
- semanticScore is a relevance score built from your recent positive minus negative article votes (Curator's built-in semantic engine, plus your embeddings provider when configured); higher values are a better match.
- Articles thumbs-up: ${JSON.stringify(moreIds)}
- Articles thumbs-down: ${JSON.stringify(lessIds)} (exact downvoted articles and any legacy less topics are already excluded)
Serendipity Dial: ${serendipityDial}% (0% = stay close to established interests; 100% = stretch into unfamiliar intellectual territories).

CURATION RULES:
1. Select exactly ${itemCount} unique items from the candidate pool using their "idx".
2. Strongly prioritize candidates marked isLiked, matchesPreferredTopic, or with higher semanticScore; avoid negative semanticScore candidates when similar alternatives exist.
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
            return res.json({ digest: aiDigest, generatedByAI: true, semanticSummary, feedReport });
          }
        }
      }

      // 3. Deterministic signal-aware curation over the semantically ranked pool
      const likedExamples = feedbackExamples.filter(entry => entry.vote === 'like');
      const familiarSources = new Set(
        likedExamples.map(entry => entry.source).filter((value): value is string => Boolean(value))
      );
      const familiarFolders = new Set(
        likedExamples.map(entry => entry.folder).filter((value): value is string => Boolean(value))
      );
      if (familiarFolders.size === 0 && rankedItems.length > 0) {
        const folderCounts = new Map<string, number>();
        rankedItems.slice(0, 10).forEach(item => {
          const key = item.folder || '';
          if (!key) return;
          folderCounts.set(key, (folderCounts.get(key) || 0) + 1);
        });
        const leadingFolder = [...folderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (leadingFolder) familiarFolders.add(leadingFolder);
      }

      const stretchTarget = serendipityDial >= 50
        ? Math.min(2, itemCount)
        : serendipityDial >= 20
          ? Math.min(1, itemCount)
          : 0;
      const stretchItems: any[] = [];
      if (stretchTarget > 0) {
        for (const item of rankedItems) {
          if (stretchItems.length >= stretchTarget) break;
          const source = item.source || '';
          const folder = item.folder || '';
          if (familiarSources.has(source) || familiarFolders.has(folder)) continue;
          const publishedMs = Number(item.publishedAtMs);
          if (Number.isFinite(publishedMs) && Date.now() - publishedMs > 45 * 24 * 60 * 60 * 1000) continue;
          stretchItems.push({
            ...item,
            isOutOfBubble: true,
            why: `Deliberate stretch: outside your usual ${familiarFolders.size > 0 ? [...familiarFolders][0] : (folder || 'reading')} routine.`
          });
        }
      }

      const stretchIds = new Set(stretchItems.map(item => item.id));
      const regular = selectDiverse(
        rankedItems.filter(item => !stretchIds.has(item.id)),
        Math.max(0, itemCount - stretchItems.length),
        maxPerSource
      );
      const digest = [...regular, ...stretchItems].slice(0, itemCount);

      res.json({ digest, generatedByAI: false, semanticSummary, feedReport });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate digest' });
    }
  });

  // Calibration pool for the setup wizard: a spread of recent articles to vote on
  app.post('/api/calibrate', async (req, res) => {
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
        ordered.slice(0, 14).map((s: any) => fetchFeedArticles(s.feedUrl, s.title, s.folder))
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
          folder: item.folder,
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
            model: process.env.GEMINI_DISCOVERY_MODEL || 'gemini-2.5-flash',
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
