// One publication can reach the library more than once: an import, a restored backup, or a feed
// that moved to a new address leaves two rows behind. The digest then reads the same stories
// twice and Sources shows one publication under two names, so the list is collapsed to one row
// per feed when it is loaded.

import { explainFeedFailure } from './feedHealth';

export interface DedupeCandidate {
  title?: string;
  feedUrl?: string;
  status?: string;
  failingReason?: string;
  paused?: boolean;
}

// Two addresses that differ only in scheme or a leading www. are one feed: the same publication
// answers on either. This is the app's one notion of feed identity, shared with the add form and
// the import merge, so a duplicate is refused the same way everywhere.
export const normalizeFeedUrl = (url?: string): string =>
  (url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

const normalizeTitle = (title?: string): string => (title || '').replace(/\s+/g, ' ').trim().toLowerCase();

const isFailing = (source: DedupeCandidate): boolean =>
  source.status === 'failing' || Boolean(source.failingReason);

// The rows the Sources list already calls safe to delete: a missing page, a feed that carries
// nothing, an address that was never a feed.
const isDead = (source: DedupeCandidate): boolean =>
  isFailing(source) && explainFeedFailure(source.failingReason).likelyDead;

// Higher is closer to working, so a collapse keeps the row the reader can still use.
const healthRank = (source: DedupeCandidate): number => {
  if (source.paused) return 0;
  if (!isFailing(source)) return 4;
  const { kind, likelyDead } = explainFeedFailure(source.failingReason);
  if (!likelyDead) return 3;
  // A feed that answers but carries nothing could publish again; a vanished page cannot.
  return kind === 'inactive' ? 2 : 1;
};

// Returns the same array when there was nothing to collapse, so a clean load does not look like
// a change to storage.
export function dedupeSources<T extends DedupeCandidate>(sources: T[]): T[] {
  if (!Array.isArray(sources) || sources.length < 2) return sources;
  const survivors: number[] = sources.map((_, index) => index);

  // Same address is the same feed, whatever the row is called: keep the healthier row.
  const byAddress = new Map<string, number>();
  sources.forEach((source, index) => {
    const address = normalizeFeedUrl(source.feedUrl);
    if (!address) return;
    const kept = byAddress.get(address);
    if (kept === undefined) {
      byAddress.set(address, index);
      return;
    }
    const winner = healthRank(source) > healthRank(sources[kept]) ? index : kept;
    const loser = winner === index ? kept : index;
    byAddress.set(address, winner);
    survivors[loser] = -1;
  });

  // A shared name is weaker evidence than a shared address, so it only ever removes a row the
  // app already calls dead. Two working subscriptions with the same title stay: they may be a
  // newsletter and its podcast, and neither should disappear for being called the same thing.
  const byTitle = new Map<string, number[]>();
  sources.forEach((source, index) => {
    if (survivors[index] === -1) return;
    const title = normalizeTitle(source.title);
    if (!title) return;
    const group = byTitle.get(title);
    if (group) group.push(index);
    else byTitle.set(title, [index]);
  });

  byTitle.forEach(group => {
    if (group.length < 2) return;
    const dead = group.filter(index => isDead(sources[index]));
    if (dead.length === 0) return;
    const live = group.filter(index => !isDead(sources[index]));
    if (live.some(index => !isFailing(sources[index]))) {
      dead.forEach(index => { survivors[index] = -1; });
      return;
    }
    // Every row under this name is dead: one row is left, the one closest to working.
    const best = dead.reduce((winner, index) =>
      healthRank(sources[index]) > healthRank(sources[winner]) ? index : winner);
    dead.forEach(index => {
      if (index !== best) survivors[index] = -1;
    });
  });

  const kept = survivors.filter(index => index !== -1).map(index => sources[index]);
  return kept.length === sources.length ? sources : kept;
}
