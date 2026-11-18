// What a provider says when it refuses a request arrives as a JSON envelope, or as a page
// of HTML from a proxy in front of it. Settings shows that reason to the reader, so this
// turns either shape into one readable line instead of echoing the raw body.

const DETAIL_LIMIT = 300;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const truncate = (text: string): string => (
  text.length <= DETAIL_LIMIT ? text : `${text.slice(0, DETAIL_LIMIT - 1).trimEnd()}…`
);

// Providers nest the reason differently (error.message, message, detail) and some send a
// field-by-field list of validation errors instead of one string.
const readMessage = (value: unknown): string => {
  if (typeof value === 'string') return collapse(value);
  if (Array.isArray(value)) return collapse(value.map(part => readMessage(part)).filter(Boolean).join(' '));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return readMessage(record.message) || readMessage(record.detail) || readMessage(record.msg);
  }
  return '';
};

// The provider's own words for a failure, without the JSON around them.
export const providerErrorDetail = (bodyText: string): string => {
  const body = (bodyText || '').trim();
  if (!body) return '';
  try {
    const parsed = JSON.parse(body);
    const message = readMessage(parsed?.error) || readMessage(parsed?.message) || readMessage(parsed?.detail);
    if (message) return truncate(message);
  } catch {
    // Not JSON: an HTML error page, or plain text from a proxy. Fall through to the text.
  }
  return truncate(collapse(body.replace(/<[^>]*>/g, ' ')));
};

// One line for Settings and the startup check: the status, then what the provider said.
export const describeProviderFailure = (status: number, bodyText: string): string => {
  const detail = providerErrorDetail(bodyText);
  return detail
    ? `AI provider error: ${status} — ${detail}`
    : `AI provider error: ${status} with no detail in the response.`;
};
