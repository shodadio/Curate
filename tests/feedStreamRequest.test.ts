import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SINGLE_REFRESH_FAILED_TOAST,
  SINGLE_SOURCE_NETWORK_REASON,
  buildFeedStreamRequest,
  buildRefreshAllRequest,
  buildSingleFeedRequest,
  findRefreshRow,
  postFeedStream,
  readFeedStreamArticles,
  readRefreshAllOutcome,
  readSingleSourceOutcome,
  refreshAllSourceUpdate,
  refreshAllToast,
} from '../lib/feedStreamRequest.ts';

const feed = { id: 'src_1', title: 'Publication', feedUrl: 'https://publication.example/feed' };

test('the stream asks for one feed or for all of them', () => {
  assert.deepEqual(buildFeedStreamRequest(undefined, [feed]), { sourceTitle: 'all', sources: [feed] });
  assert.deepEqual(buildFeedStreamRequest('Publication', [feed]), { sourceTitle: 'Publication', sources: [feed] });
});

test('a manual refresh takes the whole library and forces past the server cache', () => {
  assert.deepEqual(buildSingleFeedRequest(feed, [feed]), {
    sourceId: 'src_1',
    sourceTitle: 'Publication',
    sources: [feed],
    force: true,
  });
  assert.deepEqual(buildRefreshAllRequest('all', [feed]), { sourceTitle: 'all', sources: [feed], refreshAll: true });
});

test('the stream posts to its route and survives a body that is not JSON', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return { status: 200, json: async () => { throw new Error('html'); } } as unknown as Response;
  }) as unknown as typeof fetch;

  const response = await postFeedStream(buildFeedStreamRequest('all', [feed]), { fetchImpl });
  assert.equal(seen[0].url, '/api/feed-stream');
  assert.equal(seen[0].init.method, 'POST');
  assert.deepEqual(response, { status: 200, data: {} });
});

test('a stream reply that is not a list sets nothing', () => {
  assert.deepEqual(readFeedStreamArticles({ articles: [{ id: 'a' }] }), [{ id: 'a' }]);
  assert.deepEqual(readFeedStreamArticles({ articles: [] }), []);
  assert.equal(readFeedStreamArticles({}), null);
  assert.equal(readFeedStreamArticles(null), null);
});

test('a fetched feed brings its articles; anything else names the failure', () => {
  const fetched = readSingleSourceOutcome<{ id: string }>(200, { articles: [{ id: 'a' }] });
  assert.equal(fetched.fetched, true);
  assert.equal(fetched.fetched && fetched.articles.length, 1);

  const empty = readSingleSourceOutcome(200, { articles: [] });
  assert.equal(empty.fetched, false);
  assert.equal(empty.fetched === false && empty.failingReason, 'This feed returned no articles.');

  const refused = readSingleSourceOutcome(500, { error: 'Boom' });
  assert.equal(refused.fetched === false && refused.failingReason, 'Boom');

  const bareRefusal = readSingleSourceOutcome(500, {});
  assert.match(bareRefusal.fetched === false ? bareRefusal.failingReason : '', /HTTP 500/);
});

test('the network failure has its own words', () => {
  assert.match(SINGLE_SOURCE_NETWORK_REASON, /Network error/);
  assert.match(SINGLE_REFRESH_FAILED_TOAST, /Could not refresh that feed/);
});

test('a refresh run is matched to its source by id or by name', () => {
  const rows = [{ id: 'src_1', ok: true }, { title: 'Other', ok: false, error: 'Down' }];
  assert.equal(findRefreshRow(rows, { id: 'src_1', title: 'Publication' }), rows[0]);
  assert.equal(findRefreshRow(rows, { id: 'src_9', title: 'Other' }), rows[1]);
  assert.equal(findRefreshRow(rows, { id: 'src_9', title: 'Nobody' }), undefined);
});

test('a refused refresh names the server error rather than succeeding empty', () => {
  assert.deepEqual(readRefreshAllOutcome(500, { error: 'Waking up' }), { kind: 'error', message: 'Waking up' });
  const ok = readRefreshAllOutcome<{ id: string }>(200, { articles: [{ id: 'a' }], sources: [{ id: 'src_1', ok: true }] });
  assert.equal(ok.kind, 'ok');
});

test('an answering feed is cleared of its failure, and a silent run says nothing', () => {
  const update = refreshAllSourceUpdate({ id: 'src_1', ok: true }, { consecutiveFailures: 2 }, 9000);
  assert.deepEqual(update, { lastSyncedAt: 9000, status: 'active', failingReason: undefined, consecutiveFailures: 0 });
  assert.equal(refreshAllSourceUpdate(undefined, {}, 9000), null);
});

test('a failing feed counts, and pauses with a reason on the crossing run', () => {
  const failing = refreshAllSourceUpdate({ id: 'src_1', ok: false, error: 'Timed out' }, { consecutiveFailures: 1 }, 9000, 3);
  assert.equal(failing?.status, 'failing');
  assert.equal(failing?.consecutiveFailures, 2);
  assert.equal(failing?.paused, undefined);

  const pausing = refreshAllSourceUpdate({ id: 'src_1', ok: false }, { consecutiveFailures: 2 }, 9000, 3);
  assert.equal(pausing?.paused, true);
  assert.match(String(pausing?.pausedReason), /failed reads in a row/);
});

test('the wrap-up names every feed, most feeds, or only the entries', () => {
  assert.equal(refreshAllToast([{ ok: true }, { ok: true }], 9), 'Refreshed all 2 feeds');
  assert.equal(refreshAllToast([{ ok: true }, { ok: false }], 4), 'Refreshed 1 of 2 feeds — the rest did not answer');
  assert.equal(refreshAllToast([], 3), 'Refreshed 3 entries');
  assert.equal(refreshAllToast([], 1), 'Refreshed 1 entry');
});
