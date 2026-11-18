import { cleanHtml } from './markup';

const DESCRIPTION_LIMIT = 300;

const trimDescription = (raw: string): string => {
  const description = cleanHtml(raw);
  if (description.length <= DESCRIPTION_LIMIT) return description;
  return `${description.slice(0, DESCRIPTION_LIMIT - 3).replace(/\s+\S*$/, '')}…`;
};

const readAttribute = (tag: string, name: string): string => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
};

// The publication's own blurb, from RSS channel metadata or an Atom feed subtitle.
export const parseFeedChannelDescription = (xml: string): string => {
  if (!xml) return '';
  const beforeFirstItem = xml.split(/<(?:item|entry)\b/i)[0] || '';
  const candidates = [
    beforeFirstItem.match(/<description[^>]*>([\s\S]*?)<\/description>/i),
    beforeFirstItem.match(/<subtitle[^>]*>([\s\S]*?)<\/subtitle>/i),
    beforeFirstItem.match(/<itunes:summary[^>]*>([\s\S]*?)<\/itunes:summary>/i),
  ];

  for (const match of candidates) {
    const description = match ? trimDescription(match[1]) : '';
    if (description) return description;
  }
  return '';
};

// Prefer the publication URL declared by the feed, falling back to the feed URL's origin.
export const parseFeedSiteUrl = (xml: string, feedUrl: string): string => {
  let fallback = '';
  try {
    const parsedFeedUrl = new URL(feedUrl);
    if ((parsedFeedUrl.protocol !== 'http:' && parsedFeedUrl.protocol !== 'https:') || parsedFeedUrl.username || parsedFeedUrl.password) return '';
    fallback = parsedFeedUrl.origin;
  } catch {
    return '';
  }

  const beforeFirstItem = (xml || '').split(/<(?:item|entry)\b/i)[0] || '';
  const linkTags = beforeFirstItem.match(/<link\b[^>]*>/gi) || [];
  let candidate = '';
  for (const tag of linkTags) {
    const href = readAttribute(tag, 'href');
    const rel = readAttribute(tag, 'rel').toLowerCase();
    if (href && (!rel || rel.split(/\s+/).includes('alternate'))) {
      candidate = href;
      break;
    }
  }

  if (!candidate) {
    const rssLink = beforeFirstItem.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    candidate = rssLink ? cleanHtml(rssLink[1]) : '';
  }

  try {
    const siteUrl = new URL(candidate || fallback, feedUrl);
    if ((siteUrl.protocol !== 'http:' && siteUrl.protocol !== 'https:') || siteUrl.username || siteUrl.password) return fallback;
    return siteUrl.toString();
  } catch {
    return fallback;
  }
};

const AUTHOR_LIMIT = 80;

// Machine accounts and placeholders are not bylines: "admin" or "Anonymous" credits nobody,
// so the reader is better off falling back to the publication's own name.
const NON_AUTHOR_NAMES = new Set([
  'admin', 'administrator', 'editor', 'staff', 'webmaster', 'wordpress', 'unknown',
  'n/a', 'na', 'anonymous', 'none',
]);

const tidyAuthor = (raw: string): string => {
  // Atom nests the writer's name; RSS puts it straight in the tag.
  const named = raw.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i);
  let value = cleanHtml(named ? named[1] : raw);
  // RSS writes the writer as "address (Name)"; the bracketed part is the byline.
  const bracketed = value.match(/\(([^)]+)\)/);
  if (bracketed) value = bracketed[1];
  value = value
    .replace(/^\s*(?:by|words by|story by|written by|posted by)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value || value.length > AUTHOR_LIMIT) return '';
  if (!/\p{L}/u.test(value)) return '';
  // An address is not a person, whether it is an email or a site.
  if (/@|^(?:https?:\/\/|www\.)/i.test(value)) return '';
  if (NON_AUTHOR_NAMES.has(value.toLowerCase())) return '';
  return value;
};

// Feeds credit the writer in one of a few places: DC's creator, iTunes' author, or the RSS/Atom
// author block. The first tag that names someone wins, so an Atom entry's own <author> is never
// needed to displace the writer the feed named first.
const AUTHOR_PATTERNS = [
  /<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi,
  /<itunes:author\b[^>]*>([\s\S]*?)<\/itunes:author>/gi,
  /<author\b[^>]*>([\s\S]*?)<\/author>/gi,
];

/** The writer a feed item credits, empty when it names nobody usable. */
export const parseFeedItemAuthor = (block: string, sourceTitle = ''): string => {
  if (!block) return '';
  const source = cleanHtml(sourceTitle).toLowerCase();

  for (const pattern of AUTHOR_PATTERNS) {
    const names: string[] = [];
    for (const match of block.matchAll(pattern)) {
      const name = tidyAuthor(match[1]);
      // Some feeds fill the creator with the publication's own name; that is the source.
      if (!name || name.toLowerCase() === source) continue;
      if (names.some(existing => existing.toLowerCase() === name.toLowerCase())) continue;
      names.push(name);
    }

    if (names.length === 1) return names[0];
    if (names.length > 1) {
      const joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return joined.length <= AUTHOR_LIMIT ? joined : names[0];
    }
  }

  return '';
};

// Feeds sometimes omit their own blurb; use the publication page's standard metadata as a fallback.
export const parseSitePageDescription = (html: string): string => {
  if (!html) return '';
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const values = metaTags.map(tag => ({
    name: readAttribute(tag, 'name').toLowerCase(),
    property: readAttribute(tag, 'property').toLowerCase(),
    content: readAttribute(tag, 'content'),
  }));
  const candidates = [
    ...values.filter(meta => meta.name === 'description'),
    ...values.filter(meta => meta.property === 'og:description'),
    ...values.filter(meta => meta.name === 'twitter:description'),
  ];

  for (const meta of candidates) {
    const description = trimDescription(meta.content);
    if (description) return description;
  }
  return '';
};
