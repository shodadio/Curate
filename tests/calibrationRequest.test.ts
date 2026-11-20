import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CALIBRATION_UNREACHABLE,
  buildCalibrationRequest,
  postCalibration,
  readCalibrationOutcome,
} from '../lib/calibrationRequest.ts';

test('calibration sends the feeds and the ids already voted on', () => {
  assert.deepEqual(buildCalibrationRequest([{ id: 'src_0' }], ['voted']), {
    sources: [{ id: 'src_0' }],
    excludeIds: ['voted'],
  });
});

test('readable candidates continue the setup flow', () => {
  const outcome = readCalibrationOutcome<{ id: string }>(200, { candidates: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(outcome.kind, 'candidates');
  assert.deepEqual(outcome.kind === 'candidates' && outcome.candidates.length, 2);
});

test('a refusal, an empty page and a body that is not a list all say the same thing', () => {
  assert.deepEqual(readCalibrationOutcome(500, { error: 'Down' }), { kind: 'error', message: 'Down' });
  assert.match(readCalibrationOutcome(200, { candidates: [] }).kind === 'error'
    ? (readCalibrationOutcome(200, { candidates: [] }) as { message: string }).message
    : '', /Check your feed URLs/);
  assert.match(readCalibrationOutcome(200, {}).kind === 'error'
    ? (readCalibrationOutcome(200, {}) as { message: string }).message
    : '', /No live articles/);
});

test('a request that never answers has its own words', () => {
  assert.match(CALIBRATION_UNREACHABLE, /Could not reach your feeds/);
});

test('calibration posts to its route with the profile it was given', async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return { status: 200, json: async () => ({ candidates: [] }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const payload = buildCalibrationRequest([{ id: 'src_0' }], []);
  const response = await postCalibration(payload, { fetchImpl });
  assert.equal(seen[0].url, '/api/calibrate');
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), { sources: [{ id: 'src_0' }], excludeIds: [] });
  assert.equal(response.status, 200);
});
