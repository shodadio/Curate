// A feed stops answering in a handful of recognisable ways. The Sources page has to tell the
// reader which kind of failure it is, because a missing page will never fix itself while a
// timeout usually will. The wording here is what someone sees, so it stays plain and free of
// status codes and network jargon.
export type FeedFailureKind = 'gone' | 'blocked' | 'temporary' | 'inactive' | 'invalid' | 'unknown';

export interface FeedFailureExplanation {
  kind: FeedFailureKind;
  // One sentence on what went wrong, in the reader's terms.
  summary: string;
  // What that means for the source, so the reader can decide whether to keep it.
  suggestion: string;
  // A missing or unclaimed site will not recover by retrying, so it may be deleted outright.
  likelyDead: boolean;
}

const gone = (summary: string): FeedFailureExplanation => ({
  kind: 'gone',
  summary,
  suggestion: 'Retrying will not bring it back, so it is safe to delete.',
  likelyDead: true,
});

export function explainFeedFailure(reason?: string): FeedFailureExplanation {
  const text = (reason || '').trim();
  if (!text) {
    return {
      kind: 'temporary',
      summary: 'This feed did not answer when Curator last tried.',
      suggestion: 'Try again in a little while; a feed that keeps failing can be removed.',
      likelyDead: false,
    };
  }

  // The page a closed publication leaves behind: Substack says the address is unclaimed, and
  // other hosts print their own "not found" page. Both mean the same thing to the reader.
  if (/claim (?:this|your) (?:url|substack)|start (?:a |your )?substack|page you are attempting to access is not found/i.test(text)) {
    return gone('That address no longer belongs to a live publication — the page is unclaimed or gone.');
  }
  if (/\b404\b|not found/i.test(text)) {
    return gone('The feed’s page no longer exists, so the publication has probably closed, moved, or changed its address.');
  }
  if (/\b410\b|\bgone\b/i.test(text)) {
    return gone('The publication has taken this page down for good.');
  }
  if (/enotfound|eai_again|getaddrinfo|no such host|\bdns\b/i.test(text)) {
    return gone('That website address does not exist any more, so there is nothing to read.');
  }

  if (/\b(?:401|403)\b|forbidden|unauthori[sz]ed|access denied|blocked|robots/i.test(text)) {
    return {
      kind: 'blocked',
      summary: 'The site refuses automated readers, so its stories cannot be fetched.',
      suggestion: 'It may lift the block later; keep it if you read the site elsewhere.',
      likelyDead: false,
    };
  }

  if (/\b5\d\d\b|timeout|timed out|etimedout|econnreset|socket|network|fetch failed|could not be reached|took too long/i.test(text)) {
    return {
      kind: 'temporary',
      summary: 'The site is not answering right now, which is usually a passing problem.',
      suggestion: 'Try again later before removing it.',
      likelyDead: false,
    };
  }

  if (/no (?:readable|new) articles|returned no articles|no items|empty/i.test(text)) {
    return {
      kind: 'inactive',
      summary: 'The feed answers but carries no stories, so the site may have stopped publishing.',
      suggestion: 'If it stays empty, it is safe to delete.',
      likelyDead: true,
    };
  }

  if (/invalid (?:feed )?url|not a (?:valid )?url|unsupported/i.test(text)) {
    return {
      kind: 'invalid',
      summary: 'This entry does not point at a usable feed address.',
      suggestion: 'It cannot recover on its own, so it can be deleted and added again correctly.',
      likelyDead: true,
    };
  }

  // Anything unrecognised is still worth saying in the feed's own words, without guessing.
  return {
    kind: 'unknown',
    summary: text,
    suggestion: 'Retry once; if it keeps failing, it can be removed.',
    likelyDead: false,
  };
}
