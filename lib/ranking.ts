// Digest ranking: the provider-free semantic engine, the freshness/exposure penalties and
// the deterministic selector. No Express and no network calls, so every weight below is
// directly testable.

export interface SemanticVoteExample {
  id: string;
  vote: 'like' | 'dislike';
  title: string;
  text: string;
  timestamp: number;
  source?: string;
  folder?: string;
}

export interface SemanticCandidate {
  id: string;
  title?: string;
  summary?: string;
  fullText?: string;
  folder?: string;
  categories?: string[];
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

export const semanticTokens = (text: string): string[] => {
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

export const semanticTermCounts = (text: string): Map<string, number> => {
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

export const composeSemanticText = (item: SemanticCandidate): string => {
  const title = item.title || '';
  const folder = item.folder || '';
  const categories = Array.isArray(item.categories) ? item.categories.join('. ') : '';
  const summary = item.summary || '';
  const full = String(item.fullText || '').slice(0, 1800);
  return `${title}. ${title}. ${title}. ${folder}. ${folder}. ${categories}. ${categories}. ${summary}. ${summary}. ${full}`;
};

export const buildSemanticVectors = (documents: string[]): Array<Map<string, number>> => {
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

export const sparseCosine = (left: Map<string, number>, right: Map<string, number>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  small.forEach((value, term) => {
    const other = large.get(term);
    if (other) dot += value * other;
  });
  return dot;
};

export const SPARSE_FEEDBACK_HALF_LIFE_MS = 60 * 24 * 60 * 60 * 1000;
export const DENSE_FEEDBACK_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

export const buildSparseCentroid = (
  vote: 'like' | 'dislike',
  examples: SemanticVoteExample[],
  vectors: Array<Map<string, number> | null>,
  nowMs: number = Date.now(),
): Map<string, number> | null => {
  const halfLifeMs = SPARSE_FEEDBACK_HALF_LIFE_MS;
  const centroid = new Map<string, number>();
  let totalWeight = 0;

  examples.forEach((example, index) => {
    if (example.vote !== vote) return;
    const vector = vectors[index];
    if (!vector) return;
    const ageMs = Math.max(0, nowMs - example.timestamp);
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

export const localSemanticScores = (
  feedback: SemanticVoteExample[],
  candidates: SemanticCandidate[],
  nowMs: number = Date.now(),
): Map<string, number> => {
  const scores = new Map<string, number>();
  if (feedback.length === 0 || candidates.length === 0) return scores;

  const candidateTexts = candidates.map(composeSemanticText);
  const feedbackTexts = feedback.map(entry => `${entry.title}. ${entry.title}. ${entry.title}. ${entry.text}`);
  const vectors = buildSemanticVectors([...candidateTexts, ...feedbackTexts]);
  const feedbackVectors = vectors.slice(candidates.length);
  const usableFeedback = feedback
    .map((example, index) => ({ example, vector: feedbackVectors[index] }))
    .filter((entry): entry is { example: SemanticVoteExample; vector: Map<string, number> } => Boolean(entry.vector?.size));
  const positiveExamples = usableFeedback.filter(entry => entry.example.vote === 'like');
  const negativeExamples = usableFeedback.filter(entry => entry.example.vote === 'dislike');
  if (positiveExamples.length === 0 && negativeExamples.length === 0) return scores;

  const bestSimilarity = (
    candidateVector: Map<string, number>,
    examples: typeof usableFeedback,
    halfLifeMs: number,
  ): number => {
    if (examples.length === 0) return 0;
    const latestTimestamp = Math.max(...examples.map(({ example }) =>
      Number.isFinite(example.timestamp) ? example.timestamp : nowMs
    ));
    return examples.reduce((best, { example, vector }) => {
      const timestamp = Number.isFinite(example.timestamp) ? example.timestamp : nowMs;
      const ageMs = Math.max(0, latestTimestamp - timestamp);
      const recency = Math.pow(0.5, ageMs / halfLifeMs);
      return Math.max(best, sparseCosine(candidateVector, vector) * recency);
    }, 0);
  };

  vectors.slice(0, candidates.length).forEach((vector, index) => {
    const candidate = candidates[index];
    if (!candidate || !candidate.id) return;
    const positiveSimilarity = bestSimilarity(vector, positiveExamples, SPARSE_FEEDBACK_HALF_LIFE_MS);
    const negativeSimilarity = bestSimilarity(vector, negativeExamples, SPARSE_FEEDBACK_HALF_LIFE_MS);
    const score = positiveExamples.length > 0 && negativeExamples.length > 0
      ? (positiveSimilarity - negativeSimilarity) / 2
      : positiveExamples.length > 0
        ? positiveSimilarity
        : -negativeSimilarity;
    if (Number.isFinite(score)) scores.set(candidate.id, score);
  });

  return scores;
};

// Recency from the feed's own publication date, falling back to a neutral value.
export const recencyWeight = (item: { publishedAtMs?: number }, nowMs: number = Date.now()): number => {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return 0.45;
  const ageDays = Math.max(0, (nowMs - published) / (24 * 60 * 60 * 1000));
  return Math.exp(-ageDays / 5);
};

// How fresh an article is, in words, for the editorial "why" line.
export const recencyPhrase = (item: { publishedAtMs?: number }, nowMs: number = Date.now()): string => {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return '';
  const ageHours = Math.max(0, (nowMs - published) / (60 * 60 * 1000));
  if (ageHours <= 24) return 'today';
  if (ageHours <= 96) return 'this week';
  if (ageHours <= 24 * 21) return 'this month';
  return '';
};

// A distinct, specific "why" per card: reason first, then a rotating phrasing so a digest
// drawn from one dominant feed does not repeat the same sentence on every card.
export const buildWhyLine = (
  item: any,
  index: number,
  context: { liked: boolean; interest?: string; semanticScore: number },
  nowMs: number = Date.now(),
): string => {
  const source = String(item.source || 'your feeds').trim();
  const folder = String(item.folder || '').trim();
  const ageLabel = recencyPhrase(item, nowMs);

  if (context.liked) {
    return `Selected for your reading interest in ${folder || source}.`;
  }
  if (context.interest) {
    return `Selected because you asked for more of ${context.interest}.`;
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
export const stableJitter = (seed: string, id: string): number => {
  let hash = 2166136261;
  const input = `${seed}|${id}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
};

// Greedy selection that avoids one prolific feed taking over the whole digest.
export const selectDiverse = (
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

export const normalizeInterestLabel = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9&+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Declared interests match whole-word and case-insensitively; category labels are checked
// exactly first, so a chip named "Art" never fires on "artificial".
export const matchesInterest = (item: any, label: string): boolean => {
  const needle = normalizeInterestLabel(label);
  if (!needle) return false;
  if (Array.isArray(item.categories) && item.categories.some((category: unknown) => normalizeInterestLabel(String(category || '')) === needle)) return true;
  const haystack = ` ${normalizeInterestLabel(`${item.title || ''} ${item.summary || ''}`)} `;
  return haystack.includes(` ${needle} `);
};

// Freshness: a piece the browser already showed is pushed down, hardest right after it ran.
export const EXPOSURE_TIERS: Array<{ underHours: number; penalty: number }> = [
  { underHours: 18, penalty: 65 },
  { underHours: 72, penalty: 28 },
  { underHours: 336, penalty: 8 },
];

export const buildExposurePenalty = (
  recentlyShown: Array<{ id: string; shownAt: number }>,
  nowMs: number = Date.now(),
): Map<string, number> => {
  const exposurePenalty = new Map<string, number>();
  recentlyShown.forEach(entry => {
    const ageHours = Math.max(0, (nowMs - entry.shownAt) / (60 * 60 * 1000));
    const penalty = ageHours < 18 ? 65 : ageHours < 72 ? 28 : ageHours < 336 ? 8 : 0;
    if (penalty > 0) {
      exposurePenalty.set(entry.id, Math.max(exposurePenalty.get(entry.id) || 0, penalty));
    }
  });
  return exposurePenalty;
};

// Provider embeddings are blended on top of the built-in engine, never replacing it.
export const PROVIDER_SCORE_WEIGHT = 0.65;
export const LOCAL_SCORE_WEIGHT = 0.35;

export const blendSemanticScores = (providerScore: number, localScore: number): number =>
  providerScore * PROVIDER_SCORE_WEIGHT + localScore * LOCAL_SCORE_WEIGHT;

export const cosineSimilarity = (left: number[], right: number[]): number => {
  if (left.length !== right.length || left.length === 0) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
};

// Score against individual feedback examples rather than averaging every interest into one
// vector. This preserves distinct topics while letting newer votes outweigh older ones.
export const denseFeedbackScores = (
  feedback: SemanticVoteExample[],
  feedbackEmbeddings: Array<number[] | null>,
  candidateEmbeddings: Array<number[] | null>,
  nowMs: number = Date.now(),
): number[] => {
  const latestByVote: Record<'like' | 'dislike', number> = { like: -Infinity, dislike: -Infinity };
  feedback.forEach((example, index) => {
    if (!feedbackEmbeddings[index]) return;
    const timestamp = Number.isFinite(example.timestamp) ? example.timestamp : nowMs;
    latestByVote[example.vote] = Math.max(latestByVote[example.vote], timestamp);
  });

  const scoreFor = (candidate: number[] | null): number => {
    if (!candidate) return 0;
    const bestByVote: Record<'like' | 'dislike', number> = { like: 0, dislike: 0 };
    feedback.forEach((example, index) => {
      const vector = feedbackEmbeddings[index];
      if (!vector) return;
      const latestTimestamp = latestByVote[example.vote];
      const timestamp = Number.isFinite(example.timestamp) ? example.timestamp : nowMs;
      const ageMs = Math.max(0, latestTimestamp - timestamp);
      const recency = Math.pow(0.5, ageMs / DENSE_FEEDBACK_HALF_LIFE_MS);
      const similarity = cosineSimilarity(candidate, vector) * recency;
      bestByVote[example.vote] = Math.max(bestByVote[example.vote], similarity);
    });
    return (bestByVote.like - bestByVote.dislike) / 2;
  };

  return candidateEmbeddings.map(scoreFor);
};

export const buildDenseCentroid = (
  vote: 'like' | 'dislike',
  examples: Array<{ vote: 'like' | 'dislike'; timestamp: number }>,
  embeddings: Array<number[] | null>,
  nowMs: number = Date.now(),
): number[] | null => {
  let centroid: number[] = [];
  let totalWeight = 0;
  const halfLifeMs = DENSE_FEEDBACK_HALF_LIFE_MS;

  examples.forEach((example, index) => {
    const vector = embeddings[index];
    if (example.vote !== vote || !vector) return;
    if (centroid.length === 0) centroid = Array(vector.length).fill(0);
    if (centroid.length !== vector.length) return;
    const ageMs = Math.max(0, nowMs - example.timestamp);
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

// The weights that turn ranking inputs into one comparable score. Exported so the tests can
// name them instead of hard-coding magic numbers.
export const SCORE_WEIGHTS = {
  recency: 45,
  semantic: 120,
  jitter: 12,
  liked: 30,
  interest: 25,
  lessTopic: -40,
  finished: 8,
};

export interface ScoreOptions {
  seed: string;
  semanticScores?: Map<string, number>;
  moreIds?: string[];
  moreTopics?: string[];
  lessTopics?: string[];
  readingStats?: Record<string, { finished?: boolean }> | null;
  exposurePenalty?: Map<string, number>;
  nowMs?: number;
}

export function scoreCandidates(
  pool: any[],
  options: ScoreOptions,
): { scored: any[]; deprioritizedIds: Set<string> } {
  const semanticScores = options.semanticScores || new Map<string, number>();
  const moreIds = options.moreIds || [];
  const moreTopics = options.moreTopics || [];
  const lessTopics = options.lessTopics || [];
  const exposurePenalty = options.exposurePenalty || new Map<string, number>();
  const nowMs = options.nowMs ?? Date.now();
  const deprioritizedIds = new Set<string>();

  const scored = pool
    .map((item: any) => {
      const semanticScore = semanticScores.get(item.id) || 0;
      const liked = moreIds.includes(item.id);
      const interestLabel = moreTopics.find((label: string) => matchesInterest(item, label)) || '';
      const lessLabel = lessTopics.find((label: string) => matchesInterest(item, label)) || '';
      const penalty = exposurePenalty.get(item.id) || 0;
      if (penalty > 0) deprioritizedIds.add(item.id);

      let score = recencyWeight(item, nowMs) * SCORE_WEIGHTS.recency
        + semanticScore * SCORE_WEIGHTS.semantic
        + stableJitter(options.seed, item.id) * SCORE_WEIGHTS.jitter
        - penalty;
      if (liked) score += SCORE_WEIGHTS.liked;
      if (interestLabel) score += SCORE_WEIGHTS.interest;
      if (lessLabel) score += SCORE_WEIGHTS.lessTopic;
      if (options.readingStats && options.readingStats[item.id]?.finished) score += SCORE_WEIGHTS.finished;

      return {
        ...item,
        isOutOfBubble: false,
        _score: score,
        _semantic: semanticScore,
        _interest: interestLabel,
        _less: lessLabel,
      };
    })
    .sort((a, b) => b._score - a._score);

  return { scored, deprioritizedIds };
}

// Spread the digest across sources: at least 2 per source, but never so many that one feed
// fills the edition.
export const maxPerSourceFor = (itemCount: number, distinctSources: number): number =>
  Math.max(2, Math.min(itemCount, Math.ceil(itemCount / Math.max(1, distinctSources))));

export const stretchTargetFor = (serendipityDial: number, itemCount: number): number =>
  serendipityDial >= 50
    ? Math.min(2, itemCount)
    : serendipityDial >= 20
      ? Math.min(1, itemCount)
      : 0;

export const MAX_STRETCH_AGE_MS = 45 * 24 * 60 * 60 * 1000;

// The digest is a daily edition: only pieces published in the last day are candidates. Older
// pieces stay readable in the Feeds stream, but they never crowd today's finite list.
export const DIGEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Undated feeds and slightly future-dated posts (timezone drift) still count; only a piece
// proven older than the window is dropped.
export const withinDigestWindow = (
  item: { publishedAtMs?: number },
  nowMs: number = Date.now(),
  maxAgeMs: number = DIGEST_MAX_AGE_MS,
): boolean => {
  const published = Number(item?.publishedAtMs);
  if (!Number.isFinite(published) || published <= 0) return true;
  return nowMs - published <= maxAgeMs;
};

export interface FreshPoolExclusions {
  previousDigestIds?: string[];
  shownIds?: string[];
  actionedIds?: string[];
}

// A refresh builds the edition from what is left after the reader's own history: saved, opened,
// voted and hidden pieces, plus anything this browser already showed. There is deliberately no
// fallback to the previous edition — an empty result means "nothing new", never "reshuffle the
// same cards into a fresh-looking list".
export function freshCandidates<T extends { id: string }>(pool: T[], exclusions: FreshPoolExclusions): T[] {
  const previousDigestIds = new Set(exclusions.previousDigestIds || []);
  const shownIds = new Set(exclusions.shownIds || []);
  const actionedIds = new Set(exclusions.actionedIds || []);
  return pool.filter(item =>
    !actionedIds.has(item.id) && !previousDigestIds.has(item.id) && !shownIds.has(item.id)
  );
}

// An ordinary build replaces the edition on screen. The cards in that edition may stay, but
// nothing the reader already dealt with, or saw in an earlier edition, may come back.
export function rebuildCandidates<T extends { id: string }>(pool: T[], exclusions: FreshPoolExclusions): T[] {
  const keepIds = new Set(exclusions.previousDigestIds || []);
  const shownIds = new Set(exclusions.shownIds || []);
  const actionedIds = new Set(exclusions.actionedIds || []);
  return pool.filter(item =>
    keepIds.has(item.id) || (!shownIds.has(item.id) && !actionedIds.has(item.id))
  );
}

export interface DigestSelectionOptions {
  itemCount: number;
  serendipityDial: number;
  maxPerSource: number;
  likedFeedback?: SemanticVoteExample[];
  nowMs?: number;
}

// The deterministic edition: familiar sources are learned from your likes, a serendipity-sized
// slice is drawn from outside them, and the rest is filled with the diverse selector.
export function buildDeterministicDigest(rankedItems: any[], options: DigestSelectionOptions): any[] {
  const nowMs = options.nowMs ?? Date.now();
  const likedExamples = (options.likedFeedback || []).filter(entry => entry.vote === 'like');
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

  const stretchTarget = stretchTargetFor(options.serendipityDial, options.itemCount);
  const stretchItems: any[] = [];
  if (stretchTarget > 0) {
    for (const item of rankedItems) {
      if (stretchItems.length >= stretchTarget) break;
      const source = item.source || '';
      const folder = item.folder || '';
      if (familiarSources.has(source) || familiarFolders.has(folder)) continue;
      const publishedMs = Number(item.publishedAtMs);
      if (Number.isFinite(publishedMs) && nowMs - publishedMs > MAX_STRETCH_AGE_MS) continue;
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
    Math.max(0, options.itemCount - stretchItems.length),
    options.maxPerSource
  );
  return [...regular, ...stretchItems].slice(0, options.itemCount);
}
