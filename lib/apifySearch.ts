// Source discovery has two ways out to the open web: a grounded Gemini call the reader's own key
// pays for, and Apify's Google Search actor a deployment's token pays for. The actor answers with
// one record per search page, each carrying its own list of organic results — a shape nothing else
// in this app produces — so every detail of reading it lives here, where it can be tested without
// a network call or a token.

export const APIFY_SEARCH_ACTOR = 'apify~google-search-scraper';

export interface ApifyDiscoveryCandidate {
  title: string;
  siteUrl: string;
  summary?: string;
}

export interface ApifySearchInput {
  queries: string;
  maxPagesPerQuery: number;
}

// One page of results is about ten answers, which is more than the six the screen shows; a second
// page rarely changes a topic search and costs another scraped page. `queries` is the actor's only
// required field.
export function apifySearchInput(query: string, maxPagesPerQuery = 1): ApifySearchInput {
  return { queries: query.trim(), maxPagesPerQuery };
}

// The actor's synchronous API answers with the run's dataset items, so one call is one search. The
// token travels as a query parameter because that is the shape of Apify's own endpoint; the URL is
// built here so no caller has to remember it, and it is never logged.
export function apifySearchUrl(token: string): string {
  return `https://api.apify.com/v2/acts/${APIFY_SEARCH_ACTOR}/run-sync-get-dataset-items?token=${encodeURIComponent(token.trim())}`;
}

// Hosts a topic search returns that are never a publication worth following: profiles, threads and
// reference pages. Left in, they take slots from the six results the reader actually sees.
const NOT_A_PUBLICATION = [
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'youtube.com',
  'reddit.com',
  'pinterest.com',
  'wikipedia.org',
  'amazon.com',
  'google.com',
];

// The actor stores one record per search page. A record that is itself a result (or a dataset the
// actor stored flat) still has to survive, because the shape varies with the fields switched on.
const organicResultsOf = (record: any): any[] => {
  if (Array.isArray(record?.organicResults)) return record.organicResults;
  if (typeof record?.url === 'string') return [record];
  return [];
};

/**
 * Turns an Apify Google Search dataset into the candidates the RSS investigator already takes.
 * Each candidate is a publication, not the article the search happened to land on: the article's
 * origin is what the feed probe wants, since a site's feed lives at the site rather than one post.
 */
export function apifyCandidatesFromDataset(dataset: unknown, limit = 6): ApifyDiscoveryCandidate[] {
  if (!Array.isArray(dataset)) return [];

  const candidates: ApifyDiscoveryCandidate[] = [];
  const seenOrigins = new Set<string>();

  for (const record of dataset) {
    for (const result of organicResultsOf(record)) {
      if (candidates.length >= limit) return candidates;

      const rawUrl = typeof result?.url === 'string' ? result.url.trim() : '';
      let origin: string;
      let host: string;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        origin = parsed.origin;
        host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        continue;
      }

      if (!host) continue;
      if (NOT_A_PUBLICATION.some(blocked => host === blocked || host.endsWith(`.${blocked}`))) continue;
      if (seenOrigins.has(origin)) continue;
      seenOrigins.add(origin);

      const title = typeof result?.title === 'string' && result.title.trim() ? result.title.trim() : host;
      const summary =
        typeof result?.description === 'string' ? result.description.trim()
          : typeof result?.snippet === 'string' ? result.snippet.trim()
            : '';

      const candidate: ApifyDiscoveryCandidate = { title, siteUrl: origin };
      if (summary) candidate.summary = summary;
      candidates.push(candidate);
    }
  }

  return candidates;
}
