import { cleanHtml } from './markup';

const DESCRIPTION_LIMIT = 300;

// A blurb that stops mid-phrase is worse than none: Hugo's default channel text reads
// "Recent content on" when the site title is empty, and some publishers cut their own
// description mid-sentence. Either would sit on the page as a broken line, so they count
// as missing and the fallbacks get their turn.
const DANGLING_ENDINGS = new Set([
  'on', 'of', 'for', 'to', 'in', 'with', 'by', 'from', 'about', 'at', 'as', 'into', 'over',
  'after', 'before', 'between', 'through', 'during', 'the', 'a', 'an', 'and', 'or', 'but',
  'nor', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'which', 'who', 'whom', 'whose',
  'this', 'these', 'it', 'its',
]);

export const isDegenerateDescription = (value: string): boolean => {
  const description = (value || '').trim();
  if (!description) return false;
  if (/[.?!…:;]$/.test(description)) return false;
  const last = description.split(/\s+/).pop()?.replace(/["'“”‘’()]+$/g, '').toLowerCase() || '';
  return DANGLING_ENDINGS.has(last);
};

const trimDescription = (raw: string): string => {
  const description = cleanHtml(raw);
  if (description.length <= DESCRIPTION_LIMIT) return isDegenerateDescription(description) ? '' : description;
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
    if (names.length > 1) return joinAuthorNames(names);
  }

  return '';
};

// A shared byline reads "Jane Doe and Sam Lee"; too many names collapse to the first, since a
// handful of words beside the title is a credit and a paragraph is a list.
const joinAuthorNames = (names: string[]): string => {
  if (names.length === 1) return names[0];
  const joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return joined.length <= AUTHOR_LIMIT ? joined : names[0];
};

const readMetaTag = (tag: string, name: string): string => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
};

// Structured data names the writer most reliably, sometimes across a @graph of nodes.
const authorNamesFromJsonLd = (html: string): Array<{ name: string; person: boolean }> => {
  const names: Array<{ name: string; person: boolean }> = [];
  const pushValue = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') {
      names.push({ name: value, person: false });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(entry => pushValue(entry, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.name !== 'string') return;
      const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
      names.push({ name: record.name, person: types.includes('Person') });
    }
  };
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(entry => visit(entry, depth + 1));
      return;
    }
    const record = node as Record<string, unknown>;
    if ('author' in record) pushValue(record.author);
    for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement']) {
      if (key in record) visit(record[key], depth + 1);
    }
  };

  const blocks = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    const json = block[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '').trim();
    if (!json) continue;
    try {
      visit(JSON.parse(json), 0);
    } catch {
      // A malformed block is normal on the web; the meta tags still name the writer.
    }
  }
  return names;
};

/** The writer an article page credits, empty when the page names nobody usable. */
export const parseArticleAuthor = (html: string, sourceTitle = ''): string => {
  if (!html) return '';
  const source = cleanHtml(sourceTitle).toLowerCase();
  const usable = (raw: string): string => {
    const name = tidyAuthor(raw);
    return name && name.toLowerCase() !== source ? name : '';
  };

  // Structured data often credits the writer and the publication as authors of the page;
  // the people are the byline, so an organisation is only used when nobody else is named.
  const structured = authorNamesFromJsonLd(html);
  const people = structured.filter(entry => entry.person).map(entry => entry.name);
  const structuredNames = (people.length > 0 ? people : structured.map(entry => entry.name))
    .map(usable)
    .filter((name, index, all) => Boolean(name) && all.findIndex(other => other.toLowerCase() === name.toLowerCase()) === index);
  if (structuredNames.length > 0) return joinAuthorNames(structuredNames);

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const candidates = metaTags.map(tag => ({
    name: readMetaTag(tag, 'name').toLowerCase(),
    property: readMetaTag(tag, 'property').toLowerCase(),
    content: readMetaTag(tag, 'content'),
  }));
  for (const key of ['author', 'parsely-author', 'sailthru.author', 'article:author', 'og:article:author']) {
    for (const meta of candidates) {
      if (meta.name !== key && meta.property !== key) continue;
      const author = usable(meta.content);
      if (author) return author;
    }
  }

  // A page with no author metadata still links the writer's name beside the piece.
  const relAuthor = html.match(/<a\b[^>]*\brel\s*=\s*["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  return relAuthor ? usable(relAuthor[1]) : '';
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
