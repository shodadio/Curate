// The server reads article pages a few at a time, and three passes want the same thing from it:
// citations for saved pieces, a body for a piece the edition only began, and the same bodies
// behind the reading. Keeping the request and its answer in one place means those passes agree
// on what counts as a body rather than each carrying their own copy of the rule.

// Eight at a time: enough to keep the server's four extractors busy, small enough that a progress
// bar moves every few seconds on a long queue.
export const ARTICLE_BODY_BATCH = 8;

// Text shorter than this is the page's chrome or a paywall rather than the piece
const READABLE_BODY_CHARS = 200;

export interface ArticleBodyAnswer {
  // The bodies that were read, by story id
  accepted: Map<string, string>;
  // Every story the server answered about, read or not: the difference tells a pass it may stop
  // asking about a paywalled page it has already tried
  attempted: Set<string>;
}

/**
 * Reads a batch of pages through the app's own server. Returns null when the server could not be
 * reached at all, which a background pass treats as "try again next time".
 */
export async function readArticleBodies(
  items: Array<{ id: string; url: string }>,
  signal?: AbortSignal,
): Promise<ArticleBodyAnswer | null> {
  const response = await fetch('/api/article-texts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: items.map(({ id, url }) => ({ id, url })) }),
    signal,
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  const accepted = new Map<string, string>();
  const attempted = new Set<string>();
  for (const entry of Array.isArray(data?.articles) ? data.articles : []) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (!id) continue;
    attempted.add(id);
    const text = typeof entry?.text === 'string' ? entry.text : '';
    if (text.length >= READABLE_BODY_CHARS) accepted.set(id, text);
  }
  return { accepted, attempted };
}
