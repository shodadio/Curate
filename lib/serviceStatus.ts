interface StatusResult {
  response: { status: number };
}

const RETRY_DELAYS_MS = [500, 1000, 2000] as const;

const wait = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

// A host can briefly answer 5xx while an instance starts or rolls out. Retry only the
// small read-only service checks; provider requests are intentionally never retried here.
export async function retryTransientStatus<T extends StatusResult>(
  request: () => Promise<T>,
  waitForRetry: (milliseconds: number) => Promise<void> = wait,
): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const result = await request();
      if (result.response.status < 500 || attempt === RETRY_DELAYS_MS.length) return result;
    } catch (error) {
      const isAbort = Boolean(error && typeof error === 'object' &&
        'name' in error && (error as { name?: unknown }).name === 'AbortError');
      if (isAbort || attempt === RETRY_DELAYS_MS.length) throw error;
    }

    await waitForRetry(RETRY_DELAYS_MS[attempt]);
  }

  throw new Error('Service status check ended without a response.');
}
