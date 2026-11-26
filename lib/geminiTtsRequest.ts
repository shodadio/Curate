// Gemini 3.8 TTS is only available through v1beta. Keep the request shape in one place so the
// server route and its regression test exercise the same single-speaker generateContent payload.
export const GEMINI_TTS_API_VERSION = 'v1beta';

export function geminiTtsRequest(text: string, voice: string, model: string) {
  return {
    model,
    contents: [{
      role: 'user',
      parts: [{ text }],
    }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice } },
    },
  };
}

export interface GeminiTtsUpstreamError {
  // The HTTP status Google answered with, or 0 when the call never reached one
  // (network failure, timeout, empty reply).
  status: number;
  // The human-readable refusal with Google's JSON envelope removed, so the reader
  // sees "API key not valid…" instead of a raw blob.
  message: string;
}

// The SDK throws an ApiError whose message is usually Google's whole error body:
// '{"error":{"code":400,"message":"API key not valid…"}}', sometimes led by the
// status ('503 {"error":…}'). Unwrap it into the status and the sentence to show.
export function describeGeminiTtsError(err: unknown): GeminiTtsUpstreamError {
  const record = (err && typeof err === 'object' ? err : {}) as Record<string, unknown>;
  const asStatus = (value: unknown): number | null => {
    const status = Number(value);
    return Number.isInteger(status) && status >= 400 && status < 600 ? status : null;
  };
  let status = asStatus(record.status) ?? asStatus(record.statusCode);
  const raw = typeof (err as { message?: unknown })?.message === 'string'
    ? String((err as { message: unknown }).message)
    : typeof err === 'string'
      ? err
      : '';
  if (status == null) {
    const lead = /^\s*(\d{3})\b/.exec(raw);
    if (lead) status = asStatus(Number(lead[1]));
  }
  let message = '';
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: unknown; message?: unknown };
      const nested = parsed?.error;
      if (nested && typeof nested === 'object' && typeof (nested as { message?: unknown }).message === 'string') {
        message = String((nested as { message: unknown }).message).trim();
      } else if (typeof nested === 'string') {
        message = nested.trim();
      } else if (typeof parsed?.message === 'string') {
        message = parsed.message.trim();
      }
    } catch {
      // Not JSON after all: fall through to the plain-text message below.
    }
  }
  if (!message) message = raw.replace(/^\s*\d{3}\s+/, '').trim();
  if (!message) message = 'Gemini could not speak that passage.';
  return { status: status ?? 0, message };
}
