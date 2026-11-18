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
