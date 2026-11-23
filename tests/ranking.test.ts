import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCORE_WEIGHTS,
  blendSemanticScores,
  buildDeterministicDigest,
  buildExposurePenalty,
  buildSemanticVectors,
  buildWhyLine,
  composeSemanticText,
  composeVoteText,
  cosineSimilarity,
  denseFeedbackScores,
  feedbackDecay,
  localSemanticScores,
  matchesInterest,
  maxPerSourceFor,
  recencyWeight,
  scoreCandidates,
  selectDiverse,
  semanticTermCounts,
  semanticTokens,
  sparseCosine,
  freshCandidates,
  rebuildCandidates,
  stableJitter,
  stretchTargetFor,
  withinDigestWindow,
  DIGEST_MAX_AGE_MS,
  DENSE_FEEDBACK_HALF_LIFE_MS,
  SEMANTIC_DECAY_FLOOR,
  SEMANTIC_TITLE_WEIGHT,
  type SemanticVoteExample,
} from '../lib/ranking.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

const approx = (actual: number, expected: number, message?: string) => {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message || 'value'}: expected ${expected}, got ${actual}`,
  );
};

const vote = (overrides: Partial<SemanticVoteExample> & { text: string }): SemanticVoteExample => ({
  id: overrides.id || 'vote_1',
  vote: overrides.vote || 'like',
  title: overrides.title || 'Example',
  text: overrides.text,
  timestamp: overrides.timestamp ?? NOW,
  source: overrides.source,
  folder: overrides.folder,
});

// ---------------------------------------------------------------------------
// Tokenising and TF-IDF vectors
// ---------------------------------------------------------------------------

test('semanticTokens lowercases, strips markup, drops stopwords and stems plurals', () => {
  const tokens = semanticTokens('<p>The <b>Rust</b> programmes guard memory safely</p>');
  assert.ok(tokens.includes('rust'));
  assert.ok(tokens.includes('programme'), `expected stemmed "programme" in ${tokens.join(',')}`);
  assert.ok(tokens.includes('guard'));
  assert.ok(tokens.includes('memory'));
  assert.ok(!tokens.includes('the'), 'stopwords must be dropped');
  assert.ok(tokens.includes('safely'), 'longer words keep their shape');
});

test('semanticTokens keeps two-letter and technical terms', () => {
  const tokens = semanticTokens('AI and ML at C++ and .NET, gpt-4 in the EU, a VC round');
  for (const expected of ['ai', 'ml', 'c++', '.net', 'gpt-4', 'eu', 'vc']) {
    assert.ok(tokens.includes(expected), `expected ${expected} in ${tokens.join(',')}`);
  }
  for (const stopword of ['and', 'at', 'in']) {
    assert.ok(!tokens.includes(stopword), `two-letter stopword ${stopword} stays dropped`);
  }
});

test('semanticTokens keeps plural stems honest and technical forms intact', () => {
  assert.ok(semanticTokens('business').includes('business'), 'business is not a plural');
  assert.ok(semanticTokens('analysis').includes('analysis'));
  assert.ok(semanticTokens('news').includes('news'), 'a stem that collapses into a stopword is refused');
  assert.ok(semanticTokens('programmes').includes('programme'));
  assert.ok(semanticTokens('node.js').includes('node.js'));
});

test('semanticTokens reads non-Latin scripts and bigrams space-free ones', () => {
  const russian = semanticTokens('Квантовые вычисления');
  assert.ok(russian.includes('квантовые'));
  assert.ok(russian.includes('вычисления'));
  assert.deepEqual(semanticTokens('量子计算'), ['量子', '子计', '计算']);
});

test('composeSemanticText describes an article once and caps the body', () => {
  const text = composeSemanticText({
    title: 'Quantum error correction',
    folder: 'Science',
    categories: ['Physics', 'Computing'],
    summary: 'Logical qubits improve',
    fullText: 'x'.repeat(5000),
  });
  assert.equal(text.split('Quantum error correction').length - 1, 1, 'the title appears once');
  assert.ok(text.includes('Science'));
  assert.ok(text.includes('Physics. Computing'));
  assert.ok(text.includes('Logical qubits improve'));
  assert.ok(text.length <= 1800 + 200, 'the body is capped near 1,800 characters');

  const voteText = composeVoteText(vote({ title: 'Example', text: 'body text only' }));
  assert.ok(voteText.startsWith('Example'), 'the vote title leads its body');
  assert.equal(voteText.split('Example').length - 1, 1, 'the title is not repeated into the body');
});

test('composeSemanticText weighs a headline deliberately without a second composer', () => {
  const document = { title: 'Quantum error correction', summary: 'Logical qubits improve' };
  const occurrences = (text: string) => text.split('Quantum error correction').length - 1;

  assert.equal(occurrences(composeSemanticText(document)), 1, 'the default keeps one title');
  assert.equal(
    occurrences(composeSemanticText(document, { titleEmphasis: SEMANTIC_TITLE_WEIGHT })),
    SEMANTIC_TITLE_WEIGHT,
    'the engine counts the headline deliberately more',
  );
  assert.ok(
    composeSemanticText(document, { titleEmphasis: 4 }).includes('Logical qubits improve'),
    'emphasis never touches the body',
  );
  assert.equal(occurrences(composeSemanticText(document, { titleEmphasis: 0 })), 1, 'emphasis floors at one');
  assert.equal(occurrences(composeSemanticText(document, { titleEmphasis: 99 })), 4, 'emphasis is clamped');
});

test('a headline match outweighs the same words buried in a body', () => {
  const feedback = [vote({
    title: 'Quantum error correction',
    text: 'filler words about office furniture',
    timestamp: NOW,
  })];
  const scores = localSemanticScores(feedback, [
    { id: 'headline', title: 'Quantum error correction' },
    { id: 'buried', title: 'Office furniture', fullText: 'Quantum error correction' },
  ], NOW);

  assert.ok(
    (scores.get('headline') || 0) > (scores.get('buried') || 0),
    `headline ${scores.get('headline')} should beat buried ${scores.get('buried')}`,
  );
});

test('semanticTermCounts adds adjacent bigrams at half weight', () => {
  const counts = semanticTermCounts('rust memory');
  assert.equal(counts.get('rust'), 1);
  assert.equal(counts.get('memory'), 1);
  assert.equal(counts.get('rust_memory'), 0.5);
});

test('buildSemanticVectors produces unit-length vectors and down-weights ubiquitous terms', () => {
  const [a, b, c] = buildSemanticVectors([
    'common alpha beta',
    'common alpha gamma',
    'common delta',
  ]);
  for (const vector of [a, b, c]) {
    const magnitude = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
    approx(magnitude, 1, 'vector magnitude');
  }
  // "common" appears in all three documents so its IDF weight is the smallest term weight.
  const commonWeight = a.get('common') || 0;
  const alphaWeight = a.get('alpha') || 0;
  assert.ok(alphaWeight > commonWeight, 'a rare term must outweigh a ubiquitous one');
});

test('sparseCosine is 0 for unrelated vectors and 1 for identical normalised ones', () => {
  const [a, b] = buildSemanticVectors(['alpha beta', 'alpha beta']);
  approx(sparseCosine(a, b), 1, 'identical documents');
  const [x, y] = buildSemanticVectors(['alpha beta', 'gamma delta']);
  assert.equal(sparseCosine(x, y), 0);
  assert.equal(sparseCosine(new Map(), a), 0);
});

// ---------------------------------------------------------------------------
// Feedback maths: sparse and dense matching, decay and blending
// ---------------------------------------------------------------------------

test('a recent like dominates a years-old like when directions differ', () => {
  const feedback = [
    vote({ id: 'new', vote: 'like', text: 'rust memory safety borrow checker' }),
    vote({ id: 'old', vote: 'like', text: 'gardening tomatoes compost beds', timestamp: NOW - 5 * 365 * DAY }),
  ];
  const candidates = [
    { id: 'rust', title: 'Borrow checker', summary: 'rust memory safety borrow checker' },
    { id: 'garden', title: 'Compost', summary: 'gardening tomatoes compost beds' },
  ];
  const staleScores = localSemanticScores(feedback, candidates, NOW);
  const bothFresh = feedback.map(entry => ({ ...entry, timestamp: NOW }));
  const freshScores = localSemanticScores(bothFresh, candidates, NOW);
  const recentRust = staleScores.get('rust') || 0;
  const staleGarden = staleScores.get('garden') || 0;
  const freshGarden = freshScores.get('garden') || 0;

  assert.ok(recentRust > 0.4, `a fresh vote should still score, got ${recentRust}`);
  approx(recentRust, freshScores.get('rust') || 0, 'the recent interest keeps its score');
  assert.ok(staleGarden < freshGarden * 0.2, 'a five-year-old vote decays to the floor');
  assert.ok(staleGarden > 0, 'the floor keeps a dormant interest alive');
});

test('localSemanticScores returns nothing without feedback or candidates', () => {
  assert.equal(localSemanticScores([], [{ id: 'a', title: 'x' }], NOW).size, 0);
  assert.equal(localSemanticScores([vote({ text: 'x' })], [], NOW).size, 0);
});

test('localSemanticScores ranks a liked topic above an unrelated one', () => {
  const feedback = [vote({ text: 'rust memory safety borrow checker' })];
  const scores = localSemanticScores(feedback, [
    { id: 'rust', title: 'Rust memory safety', summary: 'borrow checker' },
    { id: 'cook', title: 'Sourdough starter', summary: 'flour hydration' },
  ], NOW);
  assert.ok((scores.get('rust') || 0) > (scores.get('cook') || 0));
});

test('localSemanticScores preserves separate liked topics instead of averaging them', () => {
  const feedback = [
    vote({ id: 'rust', title: 'Rust memory safety', text: 'rust memory safety borrow checker' }),
    vote({ id: 'garden', title: 'Garden compost soil', text: 'gardening tomatoes compost soil' }),
  ];
  const scores = localSemanticScores(feedback, [
    { id: 'rust', title: 'Rust memory safety', summary: 'borrow checker' },
    { id: 'garden', title: 'Garden compost soil', summary: 'tomatoes gardening' },
    { id: 'unrelated', title: 'Classical music', summary: 'symphonies and orchestras' },
  ], NOW);
  assert.ok((scores.get('rust') || 0) > 0.7, 'the Rust interest remains independently strong');
  assert.ok((scores.get('garden') || 0) > 0.7, 'the gardening interest remains independently strong');
  assert.ok((scores.get('rust') || 0) > (scores.get('unrelated') || 0));
  assert.ok((scores.get('garden') || 0) > (scores.get('unrelated') || 0));
});

test('localSemanticScores pushes disliked topics down', () => {
  const feedback = [vote({ vote: 'dislike', text: 'crypto tokens speculation airdrop' })];
  const scores = localSemanticScores(feedback, [
    { id: 'crypto', title: 'Token speculation', summary: 'airdrop crypto tokens' },
    { id: 'bread', title: 'Sourdough starter', summary: 'flour hydration' },
  ], NOW);
  assert.ok((scores.get('crypto') || 0) < (scores.get('bread') || 0));
});

test('matching positive and negative feedback cancels into a neutral score', () => {
  const feedback = [
    vote({ id: 'up', vote: 'like', text: 'design typography grids' }),
    vote({ id: 'down', vote: 'dislike', text: 'design typography grids' }),
  ];
  const scores = localSemanticScores(feedback, [
    { id: 'same', title: 'Design typography', summary: 'grids' },
  ], NOW);
  // Identical text liked and disliked cancels out: (sim - sim) / 2 === 0.
  approx(scores.get('same') || 0, 0, 'opposed votes on the same text cancel');
});

test('an unrelated dislike does not rescale the liked topics', () => {
  const liked = vote({
    id: 'liked',
    vote: 'like',
    title: 'Quantum error correction',
    text: 'quantum computing qubits logical qubit',
  });
  const neighbours = [
    vote({ id: 'n1', vote: 'like', title: 'Quantum hardware', text: 'quantum computing qubits roadmap', timestamp: NOW - DAY }),
    vote({ id: 'n2', vote: 'like', title: 'Quantum advantage', text: 'quantum computing qubits scale', timestamp: NOW - 2 * DAY }),
  ];
  const unrelated = vote({
    id: 'hated',
    vote: 'dislike',
    title: 'Red carpet fashion',
    text: 'celebrity gossip designer dresses stylist',
  });
  const candidates = [{ id: 'on_topic', title: 'Quantum error correction', summary: 'logical qubits and quantum computing' }];

  const withoutDislike = localSemanticScores([liked, ...neighbours], candidates, NOW).get('on_topic') || 0;
  const withDislike = localSemanticScores([liked, ...neighbours, unrelated], candidates, NOW).get('on_topic') || 0;

  assert.ok(withoutDislike > 0.4, `the liked topic should score strongly, got ${withoutDislike}`);
  assert.ok(
    Math.abs(withDislike - withoutDislike) < 0.05,
    `an unrelated dislike shifted the topic from ${withoutDislike} to ${withDislike}`,
  );
});

test('a matching dislike pulls its own topic below neutral', () => {
  const feedback = [
    vote({ id: 'like', vote: 'like', title: 'Rust memory safety', text: 'rust memory safety borrow checker' }),
    vote({ id: 'hate', vote: 'dislike', title: 'Crypto tokens', text: 'crypto tokens speculation airdrop' }),
  ];
  const scores = localSemanticScores(feedback, [
    { id: 'rust', title: 'Rust memory safety', summary: 'borrow checker' },
    { id: 'crypto', title: 'Token speculation', summary: 'airdrop crypto tokens' },
  ], NOW);
  assert.ok((scores.get('rust') || 0) > 0.5);
  assert.ok((scores.get('crypto') || 0) < 0, 'a disliked topic scores below neutral');
});

test('decay is measured from the clock and stops at the floor', () => {
  const feedback = [vote({
    vote: 'like',
    title: 'Rust memory safety',
    text: 'rust memory safety borrow checker',
    timestamp: NOW,
  })];
  const candidates = [{ id: 'rust', title: 'Rust memory safety', summary: 'borrow checker' }];

  const fresh = localSemanticScores(feedback, candidates, NOW).get('rust') || 0;
  const stale = localSemanticScores(feedback, candidates, NOW + 3 * 365 * DAY).get('rust') || 0;

  assert.ok(fresh > 0.9, `a fresh vote counts in nearly full, got ${fresh}`);
  approx(stale, fresh * SEMANTIC_DECAY_FLOOR, 'a stale vote keeps the floor, not its full weight');
  approx(feedbackDecay(0, DAY), 1);
  approx(feedbackDecay(DAY, DAY), 0.5);
  approx(feedbackDecay(30 * DAY, 60 * DAY), Math.pow(0.5, 0.5));
  approx(feedbackDecay(10 * 365 * DAY, 60 * DAY), SEMANTIC_DECAY_FLOOR);
});

test('cosineSimilarity is a dot product and rejects mismatched widths', () => {
  approx(cosineSimilarity([1, 0], [1, 0]), 1);
  approx(cosineSimilarity([1, 0], [0, 1]), 0);
  approx(cosineSimilarity([0.5, 0.5], [1, 0]), 0.5);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test('denseFeedbackScores preserves multiple interests and decays older votes', () => {
  const feedback = [
    vote({ id: 'recent', vote: 'like', text: 'recent', timestamp: NOW }),
    vote({ id: 'older', vote: 'like', text: 'older', timestamp: NOW - DENSE_FEEDBACK_HALF_LIFE_MS }),
  ];
  const scores = denseFeedbackScores(
    feedback,
    [[1, 0], [0, 1]],
    [[1, 0], [0, 1]],
    NOW,
  );
  approx(scores[0], 1, 'most recent matching interest');
  approx(scores[1], 0.5, 'one-half-life-old interest is down-weighted');
});

test('provider embeddings are blended 65/35 with the built-in engine', () => {
  approx(blendSemanticScores(1, 0), 0.65);
  approx(blendSemanticScores(0, 1), 0.35);
  approx(blendSemanticScores(0.4, 0.2), 0.4 * 0.65 + 0.2 * 0.35);
});

// ---------------------------------------------------------------------------
// Freshness, interest matching and the editorial "why" line
// ---------------------------------------------------------------------------

test('recencyWeight decays on a five-day half-constant and defaults to 0.45', () => {
  approx(recencyWeight({ publishedAtMs: NOW }, NOW), 1);
  approx(recencyWeight({ publishedAtMs: NOW - 5 * DAY }, NOW), Math.exp(-1));
  approx(recencyWeight({ publishedAtMs: NOW - 10 * DAY }, NOW), Math.exp(-2));
  approx(recencyWeight({}, NOW), 0.45);
  approx(recencyWeight({ publishedAtMs: 0 }, NOW), 0.45);
  approx(recencyWeight({ publishedAtMs: NOW + 5 * DAY }, NOW), 1, 'future dates clamp to fresh');
});

test('buildExposurePenalty applies 65/28/8 across the 18h/72h/14-day tiers', () => {
  const penalty = buildExposurePenalty([
    { id: 'just_seen', shownAt: NOW - 60 * 60 * 1000 },
    { id: 'yesterday', shownAt: NOW - 2 * DAY },
    { id: 'last_week', shownAt: NOW - 7 * DAY },
    { id: 'long_ago', shownAt: NOW - 30 * DAY },
  ], NOW);
  assert.equal(penalty.get('just_seen'), 65);
  assert.equal(penalty.get('yesterday'), 28);
  assert.equal(penalty.get('last_week'), 8);
  assert.equal(penalty.has('long_ago'), false);
});

test('buildExposurePenalty keeps the harshest tier when a piece was shown twice', () => {
  const penalty = buildExposurePenalty([
    { id: 'twice', shownAt: NOW - 10 * DAY },
    { id: 'twice', shownAt: NOW - 60 * 60 * 1000 },
  ], NOW);
  assert.equal(penalty.get('twice'), 65);
});

test('matchesInterest honours whole words and exact categories', () => {
  assert.equal(matchesInterest({ title: 'The Art of War' }, 'Art'), true);
  assert.equal(matchesInterest({ title: 'Artificial intelligence' }, 'Art'), false);
  assert.equal(matchesInterest({ title: 'Artificial intelligence', categories: ['Art'] }, 'Art'), true);
  assert.equal(matchesInterest({ title: 'AI & Tech weekly' }, 'AI & Tech'), true);
  assert.equal(matchesInterest({ title: 'anything' }, ''), false);
});

test('buildWhyLine leads with the reason that actually applied', () => {
  const item = { source: 'Stratechery', folder: 'Strategy', publishedAtMs: NOW };
  assert.match(buildWhyLine(item, 0, { liked: true, semanticScore: 0 }, NOW), /reading interest in Strategy/);
  assert.match(buildWhyLine(item, 0, { liked: false, interest: 'Economics', semanticScore: 0 }, NOW), /asked for more of Economics/);
  assert.match(buildWhyLine(item, 0, { liked: false, semanticScore: 0.3 }, NOW), /upvoting/);
  assert.match(buildWhyLine(item, 0, { liked: false, semanticScore: 0.2 }, NOW), /shape of articles/);
  assert.match(buildWhyLine(item, 0, { liked: false, semanticScore: 0 }, NOW), /today from Stratechery · Strategy/);
});

test('buildWhyLine rotates its phrasing so cards do not repeat a sentence', () => {
  const item = { source: 'Stratechery', folder: 'Strategy' };
  const lines = [0, 1, 2, 3].map(index => buildWhyLine(item, index, { liked: false, semanticScore: 0 }, NOW));
  assert.equal(new Set(lines).size, 4);
  assert.equal(buildWhyLine(item, 4, { liked: false, semanticScore: 0 }, NOW), lines[0], 'the rotation wraps');
});

// ---------------------------------------------------------------------------
// Score composition
// ---------------------------------------------------------------------------

test('stableJitter is deterministic per seed and spreads ids apart', () => {
  assert.equal(stableJitter('seed-a', 'item-1'), stableJitter('seed-a', 'item-1'));
  const values = new Set(['a', 'b', 'c', 'd', 'e'].map(id => stableJitter('seed-a', id)));
  assert.ok(values.size > 1, 'different ids should not all share one jitter');
  const jitter = stableJitter('seed-a', 'item-1');
  assert.ok(jitter >= 0 && jitter < 1);
});

test('scoreCandidates applies each documented weight exactly', () => {
  const item = { id: 'a', title: 'Plain title', source: 'S', folder: 'F', publishedAtMs: NOW };
  const base = ({ scored }: { scored: any[] }) => scored[0]._score;

  const baseline = base(scoreCandidates([item], { seed: 's', nowMs: NOW }));
  approx(
    baseline,
    recencyWeight(item, NOW) * SCORE_WEIGHTS.recency + stableJitter('s', 'a') * SCORE_WEIGHTS.jitter,
    'baseline',
  );

  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, semanticScores: new Map([['a', 0.5]]) })),
    baseline + 0.5 * SCORE_WEIGHTS.semantic,
    'semantic weight',
  );
  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, moreIds: ['a'] })),
    baseline + SCORE_WEIGHTS.liked,
    'exact article thumbs-up',
  );
  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, moreTopics: ['Plain'] })),
    baseline + SCORE_WEIGHTS.interest,
    'interest topic',
  );
  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, lessTopics: ['Plain'] })),
    baseline + SCORE_WEIGHTS.lessTopic,
    'de-emphasised topic',
  );
  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, readingStats: { a: { finished: true } } })),
    baseline + SCORE_WEIGHTS.finished,
    'previously finished',
  );
  approx(
    base(scoreCandidates([item], { seed: 's', nowMs: NOW, exposurePenalty: new Map([['a', 65]]) })),
    baseline - 65,
    'recent exposure',
  );
});

test('scoreCandidates sorts best-first and reports what freshness pushed down', () => {
  const pool = [
    { id: 'plain', title: 'Plain', source: 'S1', publishedAtMs: NOW },
    { id: 'liked', title: 'Liked', source: 'S1', publishedAtMs: NOW },
    { id: 'hidden', title: 'Hidden', source: 'S1', publishedAtMs: NOW },
  ];
  const { scored, deprioritizedIds } = scoreCandidates(pool, {
    seed: 'fixed',
    nowMs: NOW,
    semanticScores: new Map([['liked', 0.8], ['plain', 0.1]]),
    exposurePenalty: new Map([['hidden', 65]]),
  });
  assert.equal(scored[0].id, 'liked');
  assert.equal(scored[scored.length - 1].id, 'hidden');
  assert.deepEqual([...deprioritizedIds], ['hidden']);
  for (let index = 1; index < scored.length; index += 1) {
    assert.ok(scored[index - 1]._score >= scored[index]._score, 'scores must be descending');
  }
});

test('scoreCandidates carries the interest labels it matched onto the item', () => {
  const { scored } = scoreCandidates(
    [{ id: 'x', title: 'Economics of shipping', source: 'S', publishedAtMs: NOW }],
    { seed: 's', nowMs: NOW, moreTopics: ['Economics'], lessTopics: ['Shipping'] },
  );
  assert.equal(scored[0]._interest, 'Economics');
  assert.equal(scored[0]._less, 'Shipping');
  assert.equal(scored[0].isOutOfBubble, false);
});

// ---------------------------------------------------------------------------
// Diversity and the deterministic edition
// ---------------------------------------------------------------------------

test('selectDiverse caps a single prolific source while alternatives exist', () => {
  const ranked = [
    ...['a', 'b', 'c'].map(id => ({ id, source: 'Noisy' })),
    ...['d', 'e'].map(id => ({ id, source: 'Quiet' })),
  ];
  const chosen = selectDiverse(ranked, 4, 2);
  assert.equal(chosen.length, 4);
  const perSource = chosen.reduce<Record<string, number>>((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});
  assert.ok((perSource.Noisy || 0) <= 2, 'the prolific source is capped');
});

test('selectDiverse relaxes the cap rather than returning a short digest', () => {
  const ranked = ['a', 'b', 'c', 'd'].map(id => ({ id, source: 'Only' }));
  assert.equal(selectDiverse(ranked, 4, 2).length, 4);
});

test('selectDiverse honours priority picks, dedupes ids and handles a zero count', () => {
  const ranked = [{ id: 'a', source: 'S' }, { id: 'b', source: 'S' }];
  const priority = [{ id: 'z', source: 'P' }];
  const chosen = selectDiverse(ranked, 2, 2, priority);
  assert.equal(chosen[0].id, 'z');
  assert.equal(chosen.length, 2);
  assert.equal(selectDiverse([{ id: 'a', source: 'S' }, { id: 'a', source: 'S' }], 5, 2).length, 1);
  assert.deepEqual(selectDiverse(ranked, 0, 2), []);
});

test('maxPerSourceFor keeps the cap sane for wide and narrow libraries', () => {
  assert.equal(maxPerSourceFor(6, 1), 6, 'a single source may fill the digest');
  assert.equal(maxPerSourceFor(6, 3), 2);
  assert.equal(maxPerSourceFor(15, 2), 8);
  assert.equal(maxPerSourceFor(3, 10), 2);
});

test('stretchTargetFor scales with the serendipity dial', () => {
  assert.equal(stretchTargetFor(0, 6), 0);
  assert.equal(stretchTargetFor(19, 6), 0);
  assert.equal(stretchTargetFor(20, 6), 1);
  assert.equal(stretchTargetFor(49, 6), 1);
  assert.equal(stretchTargetFor(50, 6), 2);
  assert.equal(stretchTargetFor(100, 1), 1, 'never more than the digest holds');
});

test('buildDeterministicDigest puts a deliberate stretch on unfamiliar ground', () => {
  const ranked = [
    { id: 'fav1', source: 'Favourite', folder: 'Tech', publishedAtMs: NOW },
    { id: 'fav2', source: 'Favourite', folder: 'Tech', publishedAtMs: NOW },
    { id: 'other1', source: 'Elsewhere', folder: 'History', publishedAtMs: NOW },
    { id: 'other2', source: 'Elsewhere', folder: 'History', publishedAtMs: NOW },
  ];
  const digest = buildDeterministicDigest(ranked, {
    itemCount: 4,
    serendipityDial: 60,
    maxPerSource: 2,
    likedFeedback: [vote({ id: 'fav1', text: 'tech', source: 'Favourite', folder: 'Tech' })],
    nowMs: NOW,
  });
  assert.equal(digest.length, 4);
  const stretch = digest.filter(item => item.isOutOfBubble);
  assert.equal(stretch.length, 2);
  for (const item of stretch) {
    assert.equal(item.folder, 'History');
    assert.match(item.why, /^Deliberate stretch: outside your usual Tech routine\.$/);
  }
  assert.equal(digest[digest.length - 1].isOutOfBubble, true, 'stretch picks close the edition');
});

test('buildDeterministicDigest adds no stretch when serendipity is dialled down', () => {
  const ranked = [
    { id: 'a', source: 'Favourite', folder: 'Tech', publishedAtMs: NOW },
    { id: 'b', source: 'Elsewhere', folder: 'History', publishedAtMs: NOW },
  ];
  const digest = buildDeterministicDigest(ranked, {
    itemCount: 2,
    serendipityDial: 0,
    maxPerSource: 2,
    likedFeedback: [vote({ text: 'tech', source: 'Favourite', folder: 'Tech' })],
    nowMs: NOW,
  });
  assert.equal(digest.length, 2);
  assert.equal(digest.some(item => item.isOutOfBubble), false);
});

test('buildDeterministicDigest refuses stale or familiar stretch candidates', () => {
  const ranked = [
    { id: 'fav', source: 'Favourite', folder: 'Tech', publishedAtMs: NOW },
    { id: 'stale', source: 'Elsewhere', folder: 'History', publishedAtMs: NOW - 90 * DAY },
  ];
  const digest = buildDeterministicDigest(ranked, {
    itemCount: 2,
    serendipityDial: 80,
    maxPerSource: 5,
    likedFeedback: [vote({ text: 'tech', source: 'Favourite', folder: 'Tech' })],
    nowMs: NOW,
  });
  assert.equal(digest.some(item => item.isOutOfBubble), false, 'a 90-day-old article is not a stretch pick');
  assert.deepEqual(digest.map(item => item.id), ['fav', 'stale'], 'it can still appear as an ordinary card');
});

test('buildDeterministicDigest infers a familiar folder from the digest when there are no votes', () => {
  const ranked = [
    { id: 'a', source: 'S1', folder: 'Tech', publishedAtMs: NOW },
    { id: 'b', source: 'S2', folder: 'Tech', publishedAtMs: NOW },
    { id: 'c', source: 'S3', folder: 'History', publishedAtMs: NOW },
  ];
  const digest = buildDeterministicDigest(ranked, {
    itemCount: 3,
    serendipityDial: 30,
    maxPerSource: 3,
    nowMs: NOW,
  });
  const stretch = digest.filter(item => item.isOutOfBubble);
  assert.equal(stretch.length, 1);
  assert.equal(stretch[0].folder, 'History');
});

test('the digest only draws from the last day of publishing', () => {
  assert.equal(DIGEST_MAX_AGE_MS, DAY);
  assert.equal(withinDigestWindow({ publishedAtMs: NOW - 23 * 60 * 60 * 1000 }, NOW), true);
  assert.equal(withinDigestWindow({ publishedAtMs: NOW - DAY }, NOW), true, 'exactly a day old still counts');
  assert.equal(withinDigestWindow({ publishedAtMs: NOW - DAY - 1 }, NOW), false, 'any older than a day is out');
  // Undated feeds and posts dated slightly ahead (timezone drift) are never treated as stale.
  assert.equal(withinDigestWindow({}, NOW), true);
  assert.equal(withinDigestWindow({ publishedAtMs: NaN }, NOW), true);
  assert.equal(withinDigestWindow({ publishedAtMs: NOW + 60 * 60 * 1000 }, NOW), true);
});

test('a refresh drops actioned, already-shown and previous-edition stories', () => {
  const pool = [{ id: 'saved' }, { id: 'opened' }, { id: 'shown' }, { id: 'previous' }, { id: 'new' }];
  const kept = freshCandidates(pool, {
    actionedIds: ['saved', 'opened'],
    shownIds: ['shown'],
    previousDigestIds: ['previous'],
  });
  assert.deepEqual(kept.map(item => item.id), ['new']);
});

test('a refresh returns nothing rather than reshuffling the old edition', () => {
  const pool = [{ id: 'a' }, { id: 'b' }];
  const kept = freshCandidates(pool, { previousDigestIds: ['a'], shownIds: ['b'] });
  assert.deepEqual(kept, [], 'no fallback to stories the browser already showed');
});

test('a refresh keeps every unseen story, including ones from another source', () => {
  const pool = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
  assert.deepEqual(freshCandidates(pool, { previousDigestIds: ['y'] }).map(item => item.id), ['x', 'z']);
});

test('an ordinary build keeps the edition on screen but never an older story', () => {
  const pool = [{ id: 'onScreen' }, { id: 'saved' }, { id: 'shown' }, { id: 'new' }];
  const kept = rebuildCandidates(pool, {
    previousDigestIds: ['onScreen'],
    actionedIds: ['saved', 'onScreen'],
    shownIds: ['shown'],
  });
  assert.deepEqual(kept.map(item => item.id), ['onScreen', 'new']);
});

test('an ordinary build drops a story the reader read in an earlier edition', () => {
  assert.deepEqual(rebuildCandidates([{ id: 'read' }, { id: 'unread' }], { actionedIds: ['read'] }).map(item => item.id), ['unread']);
});

test('an ordinary build returns nothing rather than repeating the last edition', () => {
  const pool = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(rebuildCandidates(pool, { shownIds: ['a'], actionedIds: ['b'] }), []);
});

test('buildDeterministicDigest never returns more than the requested edition size', () => {
  const ranked = Array.from({ length: 20 }, (_, index) => ({
    id: `item_${index}`,
    source: `S${index % 4}`,
    folder: index % 2 === 0 ? 'Tech' : 'History',
    publishedAtMs: NOW,
  }));
  const digest = buildDeterministicDigest(ranked, { itemCount: 5, serendipityDial: 100, maxPerSource: 2, nowMs: NOW });
  assert.equal(digest.length, 5);
  assert.equal(new Set(digest.map(item => item.id)).size, 5, 'no duplicate cards');
});
