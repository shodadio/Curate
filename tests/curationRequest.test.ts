import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIGEST_HISTORY_LIMIT,
  EMPTY_DIGEST_TOAST,
  buildDigestRequest,
  digestOutcome,
  digestTransportFailure,
  postDigest,
  readReadingStats,
  readShownHistory,
  shownHistoryAfter,
  type DigestRequestInput,
} from '../lib/curationRequest.ts';

const input = (extra: Partial<DigestRequestInput> = {}): DigestRequestInput => ({
  sources: [{ id: 'src_0', title: 'Publication' }],
  signals: { more: ['Technology'], less: ['Crypto'], moreIds: ['a'], lessIds: ['b'] },
  interests: { more: ['History'], less: ['Sport'] },
  feedback: [{ id: 'f1', vote: 'like' }],
  readingStats: { read: { finished: true } },
  shownHistory: [{ id: 'shown', shownAt: 1 }, { id: 'onScreen', shownAt: 2 }],
  currentDigestIds: ['onScreen'],
  savedIds: ['saved'],
  mutedIds: ['muted'],
  serendipityDial: 20,
  itemCount: 6,
  model: {
    provider: 'openai-compatible',
    apiKey: 'key',
    baseUrl: 'https://api.example/v1',
    model: 'gpt-4o-mini',
    embeddingProvider: 'none',
    embeddingApiKey: '',
    embeddingBaseUrl: '',
    embeddingModel: '',
  },
  fresh: false,
  now: 1000,
  random: () => 0.5,
  ...extra,
});

test('the payload carries the profile, the provider and the declared interests', () => {
  const payload = buildDigestRequest(input());
  assert.deepEqual(payload.sources, [{ id: 'src_0', title: 'Publication' }]);
  assert.deepEqual(payload.signals, { more: ['Technology'], less: ['Crypto'], moreIds: ['a'], lessIds: ['b'], moreTopics: ['History'], lessTopics: ['Sport'] });
  assert.equal(payload.provider, 'openai-compatible');
  assert.equal(payload.itemCount, 6);
  assert.equal(payload.serendipityDial, 20);
});

test('the edition on screen is not counted as already shown', () => {
  const payload = buildDigestRequest(input());
  assert.deepEqual(payload.recentlyShown, [{ id: 'shown', shownAt: 1 }]);
  assert.deepEqual(payload.previousDigestIds, ['onScreen']);
});

test('an ordinary build names every actioned story too, and keeps the stable seed', () => {
  const payload = buildDigestRequest(input());
  assert.deepEqual(payload.actionedIds.slice().sort(), ['a', 'b', 'muted', 'read', 'saved']);
  assert.equal(payload.seed, 'stable');
  assert.equal(payload.fresh, false);
});

test('a refresh names every action in the profile so nothing comes back twice', () => {
  const payload = buildDigestRequest(input({ fresh: true }));
  assert.deepEqual(payload.actionedIds.slice().sort(), ['a', 'b', 'muted', 'read', 'saved']);
  assert.equal(payload.seed, '1000-0.5');
  assert.equal(payload.fresh, true);
});

test('the most recently read stories lead the actioned list, so a cap cannot drop them', () => {
  const payload = buildDigestRequest(input({
    signals: {},
    savedIds: [],
    mutedIds: [],
    readingStats: { older: { lastRead: 1 }, newest: { lastRead: 900 }, middle: { lastRead: 500 } },
  }));
  assert.deepEqual(payload.actionedIds, ['newest', 'middle', 'older']);
});

test('the freshness history merges by id, keeps the newest and is capped', () => {
  const merged = shownHistoryAfter([{ id: 'same', shownAt: 1 }, { id: 'older', shownAt: 2 }], [{ id: 'same' }], 99);
  assert.deepEqual(merged, [{ id: 'older', shownAt: 2 }, { id: 'same', shownAt: 99 }]);

  const long = Array.from({ length: 3 }, (_, index) => ({ id: `s${index}`, shownAt: index }));
  const capped = shownHistoryAfter(long, [{ id: 'new' }], 9, 2);
  assert.deepEqual(capped.map(entry => entry.id), ['s2', 'new']);
  assert.equal(DIGEST_HISTORY_LIMIT, 150);
});

test('a damaged history or reading tally shortens memory instead of failing the request', () => {
  assert.deepEqual(readShownHistory('not json'), []);
  assert.deepEqual(readShownHistory('[{"id":"a"},{"id":"b","shownAt":"x"},{"id":"c","shownAt":3}]'), [{ id: 'c', shownAt: 3 }]);
  assert.deepEqual(readReadingStats('[]'), {});
  assert.deepEqual(readReadingStats('{"a":1}'), { a: 1 });
  assert.deepEqual(readShownHistory(null), []);
});

test('a response with stories is an edition, and carries its summary and feed report', () => {
  const outcome = digestOutcome<{ id: string }>(200, {
    digest: [{ id: 'a' }],
    semanticSummary: { feedbackExamples: 2 },
    feedReport: { attempted: 3, failed: [] },
  }, false);
  assert.equal(outcome.kind, 'edition');
  assert.deepEqual(outcome.kind === 'edition' && outcome.items, [{ id: 'a' }]);
  assert.deepEqual(outcome.kind === 'edition' && outcome.semanticSummary, { feedbackExamples: 2 });
});

test('an empty digest is its own outcome, not an error', () => {
  assert.equal(digestOutcome(200, { digest: [] }, true).kind, 'empty');
  assert.equal(digestOutcome(200, {}, true).kind, 'empty');
});

test('a refused request explains itself and lands where the reader will see it', () => {
  const empty = digestOutcome(502, { error: 'No feeds could be read' }, false);
  assert.equal(empty.kind, 'error');
  assert.equal(empty.kind === 'error' && empty.surface, 'card');
  assert.match(empty.kind === 'error' ? empty.message : '', /No feeds could be read/);

  const withEdition = digestOutcome(500, {}, true);
  assert.equal(withEdition.kind === 'error' && withEdition.surface, 'toast');
  assert.match(withEdition.kind === 'error' ? withEdition.message : '', /HTTP 500/);
});

test('a request that never answered is not worded as a refusal', () => {
  const slow = digestTransportFailure(true);
  assert.match(slow.message, /did not answer in time/);
  assert.match(slow.toast, /took too long/);
  const offline = digestTransportFailure(false);
  assert.match(offline.message, /Could not reach/);
  assert.match(offline.toast, /Could not refresh/);
  assert.equal(offline.offline, true);
});

test('the empty-edition notice names where the older stories are', () => {
  assert.match(EMPTY_DIGEST_TOAST, /Feeds/);
});

test('posting uses the curate route and survives a body that is not JSON', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return {
      status: 200,
      json: async () => { throw new Error('not json'); },
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const response = await postDigest(buildDigestRequest(input()), { fetchImpl });
  assert.equal(seen[0].url, '/api/curate');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(seen[0].init.headers, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(String(seen[0].init.body)).itemCount, 6);
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, {});
});
