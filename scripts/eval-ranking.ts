// The engine's benchmark: one fixed profile, one fixed pool, five numbers. Run with `npm run eval`.
//
// Precision@5 asks whether the digest the reader actually sees is on-topic; MRR asks how quickly
// the ranked list reaches the first on-topic story; full-over-thin asks whether an article beats
// the bare headline of the same story; determinism asks whether the same inputs give the same
// edition; runtime asks what a large fetch costs. Every engine change should be judged against
// these, not against a feeling about one digest.
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

// Measured baseline on this fixture: precision@5 1.000, MRR 1.000. The engine is at the ceiling
// here, so the floors are the baseline itself: any drop is a regression and fails the run. Lower
// a floor only with a deliberate fixture change, never to make a red run green.
const MIN_PRECISION_AT_5 = 1;
const MIN_MRR = 1;
// Baseline is two of the three pairs. This is the number with room above it: a ranker that weighs
// how much article sits behind a headline should reach three of three.
const MIN_PAIR_RATE = 2 / 3;

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

// Full over thin: does the piece with a body outrank the bare headline of the same story?
const rankOf = new Map(scored.map((item, position) => [item.id, position + 1]));
const pairWins = EVAL_PAIRS.filter(([thin, full]) =>
  (rankOf.get(full) ?? Infinity) < (rankOf.get(thin) ?? Infinity)
).length;
const pairRate = pairWins / EVAL_PAIRS.length;

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
line('deterministic', deterministic ? 'same edition twice' : 'edition changed between runs', deterministic);
line(`runtime ${RUNTIME_CANDIDATES}`, `${runtimeMs} ms (budget ${RUNTIME_BUDGET_MS})`, runtimeMs <= RUNTIME_BUDGET_MS);

if (!deterministic || precisionAt5 < MIN_PRECISION_AT_5 || mrr < MIN_MRR ||
  pairRate < MIN_PAIR_RATE || runtimeMs > RUNTIME_BUDGET_MS) {
  process.exit(1);
}
