import test from 'node:test';
import assert from 'node:assert/strict';

import { retryTransientStatus } from '../lib/serviceStatus.ts';

test('a transient 503 is retried and a healthy response clears the startup check', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await retryTransientStatus(
    async () => ({ response: { status: ++attempts === 1 ? 503 : 200 } }),
    async milliseconds => { delays.push(milliseconds); },
  );

  assert.equal(result.response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [500]);
});

test('persistent server errors are returned after three bounded retries', async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await retryTransientStatus(
    async () => {
      attempts += 1;
      return { response: { status: 503 } };
    },
    async milliseconds => { delays.push(milliseconds); },
  );

  assert.equal(result.response.status, 503);
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [500, 1000, 2000]);
});

test('client errors are not retried', async () => {
  let attempts = 0;
  const result = await retryTransientStatus(
    async () => ({ response: { status: ++attempts === 1 ? 429 : 200 } }),
    async () => {},
  );

  assert.equal(result.response.status, 429);
  assert.equal(attempts, 1);
});

test('a timed-out check is not retried', async () => {
  let attempts = 0;
  const timeout = new Error('timed out');
  timeout.name = 'AbortError';

  await assert.rejects(
    retryTransientStatus(async () => {
      attempts += 1;
      throw timeout;
    }, async () => {}),
    timeout,
  );
  assert.equal(attempts, 1);
});
