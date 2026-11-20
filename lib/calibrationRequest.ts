// The first-run calibration asks a different question than the digest — "what do you like?" —
// but talks to the same server the same way, so it gets the same treatment: the payload and the
// reply are read here, and the screen keeps only the votes that come back.

export interface CalibrationPayload {
  sources: unknown[];
  excludeIds: string[];
}

export function buildCalibrationRequest(sources: unknown[], excludeIds: string[]): CalibrationPayload {
  return { sources, excludeIds };
}

export interface CalibrationResponse {
  status: number;
  data: any;
}

export async function postCalibration(
  payload: CalibrationPayload,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<CalibrationResponse> {
  const doFetch = options.fetchImpl || fetch;
  const response = await doFetch('/api/calibrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

export type CalibrationOutcome<T> =
  | { kind: 'candidates'; candidates: T[] }
  | { kind: 'error'; message: string };

export const CALIBRATION_UNREACHABLE = 'Could not reach your feeds. Check your connection and try again.';

// A reply with no readable candidates is a failure of the same message, because the setup flow
// cannot continue on an empty page either way.
export function readCalibrationOutcome<T>(status: number, data: any): CalibrationOutcome<T> {
  const ok = status >= 200 && status < 300;
  const candidates: T[] = Array.isArray(data?.candidates) ? data.candidates : [];
  if (ok && candidates.length > 0) return { kind: 'candidates', candidates };
  return {
    kind: 'error',
    message: String(data?.error || 'No live articles came back. Check your feed URLs, then try again.'),
  };
}
