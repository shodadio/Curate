// The engine's benchmark: one fixed profile, one fixed pool, six numbers. Run with `npm run eval`.
//
// Precision@5 asks whether the digest the reader actually sees is on-topic; MRR asks how quickly
// the ranked list reaches the first on-topic story; full-over-thin asks whether an article beats
// the bare headline of the same story; stub-heavy precision asks whether a feed where only the
// wrong stories have been fetched collapses onto them; determinism asks whether the same inputs
// give the same edition; runtime asks what a large fetch costs. Every engine change should be
// judged against these, not against a feeling about one digest.
import {
  buildDeterministicDigest,
  localSemanticScores,
  scoreCandidates,
} from '../lib/ranking.ts';
import { EVAL_NOW, EVAL_PAIRS, EVAL_POOL, EVAL_PROFILE, type EvalCandidate } from '../tests/fixtures/rankingEval.ts';

const ITEM_COUNT = 5;
const SEED = 'eval';
const MAX_PER_SOURCE = 5;
const RUNTIME_CANDIDATES = 5000;
const RUNTIME_BUDGET_MS = 750;

// Measured baseline on this fixture: precision@5 1.000, MRR 1.000, all three length pairs. The
// engine is at the ceiling here, so the floors are the baseline itself: any drop is a regression
// and fails the run. Lower a floor only with a deliberate fixture change, never to make a red run
// green.
const MIN_PRECISION_AT_5 = 1;
const MIN_MRR = 1;
const MIN_PAIR_RATE = 1;
const MIN_STUB_HEAVY_PRECISION = 1;

const rank = (pool: EvalCandidate[], nowMs: number) => {
  const semanticScores = localSemanticScores(EVAL_PROFILE, pool, nowMs);
  const { scored } = scoreCandidates(pool, { seed: SEED, semanticScores, nowMs });
  const digest = buildDeterministicDigest(scored, {
    itemCount: ITEM_COUNT,
    serendipityDial: 0,
    maxPerSource: MAX_PER_SOURCE,
    likedFeedback: EVAL_PROFILE,
    nowMs,
  });
  return { scored, digest };
};

const relevantById = new Map(EVAL_POOL.map(item => [item.id, item.relevant]));

const { scored, digest } = rank(EVAL_POOL, EVAL_NOW);

const precisionAt5 = digest.filter(item => relevantById.get(item.id)).length / Math.max(1, digest.length);
const firstRelevant = scored.findIndex(item => relevantById.get(item.id));
const mrr = firstRelevant >= 0 ? 1 / (firstRelevant + 1) : 0;

// Full over thin: does the piece with a body appear above the bare headline of the same story in
// the edition the reader actually sees? This compares the final order, not the engine's score:
// recency and the tie-breaker jitter are part of what the reader gets, so a stub that floats above
// its own story is a defect even when the engine scored it lower.
const rankOf = new Map(scored.map((item, position) => [item.id, position + 1]));
const pairWins = EVAL_PAIRS.filter(([thin, full]) =>
  (rankOf.get(full) ?? Infinity) < (rankOf.get(thin) ?? Infinity)
).length;
const pairRate = pairWins / EVAL_PAIRS.length;

// Stub-heavy feed: most stories arrive as headlines until a fetcher visits, and those visits do not
// land on what the reader wants. Give every off-topic story a body and check the edition still
// leads with the reader's subjects rather than collapsing onto whatever can be read.
const stubHeavyPool: EvalCandidate[] = EVAL_POOL.map(item =>
  item.relevant ? item : { ...item, fullText: Array(6).fill(item.summary).join(' ') },
);
const stubHeavyDigest = rank(stubHeavyPool, EVAL_NOW).digest;
const stubHeavyPrecision =
  stubHeavyDigest.filter(item => relevantById.get(item.id)).length / Math.max(1, stubHeavyDigest.length);

// Determinism: the same profile, pool and clock must produce exactly the same edition.
const again = rank(EVAL_POOL, EVAL_NOW);
const order = (items: Array<{ id: string }>) => items.map(item => item.id).join(',');
const scores = (items: Array<{ id: string; _score: number }>) =>
  items.map(item => `${item.id}:${item._score.toFixed(6)}`).join(',');
const deterministic =
  order(digest) === order(again.digest) && scores(scored) === scores(again.scored);

// Runtime: a wide fetch must not stall the digest.
const widePool: EvalCandidate[] = Array.from({ length: RUNTIME_CANDIDATES }, (_unused, position) => ({
  ...EVAL_POOL[position % EVAL_POOL.length],
  id: `bench_${position}`,
}));
const startedAt = performance.now();
rank(widePool, EVAL_NOW);
const runtimeMs = Math.round(performance.now() - startedAt);

const line = (label: string, value: string, pass: boolean) =>
  console.log(`${pass ? 'pass' : 'FAIL'}  ${label.padEnd(16)} ${value}`);

console.log(`Digest for ${EVAL_PROFILE.length} votes against ${EVAL_POOL.length} labelled stories:\n`);
digest.forEach((item, position) => {
  const label = relevantById.get(item.id) ? 'on-topic ' : 'off-topic';
  console.log(`  ${position + 1}. ${label}  ${String(item.title || item.id).slice(0, 58)}`);
});
console.log('');

line('precision@5', `${(precisionAt5 * 100).toFixed(0)}% of ${digest.length}`, precisionAt5 >= MIN_PRECISION_AT_5);
line('MRR', mrr.toFixed(3), mrr >= MIN_MRR);
line('full over thin', `${pairWins}/${EVAL_PAIRS.length} pairs`, pairRate >= MIN_PAIR_RATE);
line('stub-heavy', `${(stubHeavyPrecision * 100).toFixed(0)}% of ${stubHeavyDigest.length}`, stubHeavyPrecision >= MIN_STUB_HEAVY_PRECISION);
line('deterministic', deterministic ? 'same edition twice' : 'edition changed between runs', deterministic);
line(`runtime ${RUNTIME_CANDIDATES}`, `${runtimeMs} ms (budget ${RUNTIME_BUDGET_MS})`, runtimeMs <= RUNTIME_BUDGET_MS);

if (!deterministic || precisionAt5 < MIN_PRECISION_AT_5 || mrr < MIN_MRR ||
  pairRate < MIN_PAIR_RATE || stubHeavyPrecision < MIN_STUB_HEAVY_PRECISION ||
  runtimeMs > RUNTIME_BUDGET_MS) {
  process.exit(1);
}
