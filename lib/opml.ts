// OPML import parsing, lifted out of the route so the tag scanner and folder stack can be
// tested without an HTTP server.

export interface OpmlSource {
  id: string;
  title: string;
  feedUrl: string;
  folder: string;
  categories: string[];
  status: 'active' | 'failing';
  failingReason?: string;
}

export interface OpmlFailure {
  title: string;
  reason: string;
}

export interface OpmlParseResult {
  sources: OpmlSource[];
  failures: OpmlFailure[];
  foundAnyOutline: boolean;
}

const decodeXml = (str: string) =>
  str
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (entity, value: string) => {
      const codePoint = value[0].toLowerCase() === 'x'
        ? parseInt(value.slice(1), 16)
        : parseInt(value, 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");

const getAttr = (tag: string, attr: string): string | undefined => {
  const regex = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = tag.match(regex);
  const val = match?.[1] ?? match?.[2];
  return val !== undefined ? decodeXml(val.trim()) : undefined;
};

export function parseOpmlText(opmlText: string): OpmlParseResult {
  const sources: OpmlSource[] = [];
  const failures: OpmlFailure[] = [];
  const seenUrls = new Set<string>();

  // Scan outline tags without treating a '>' inside a quoted attribute as the end of a tag.
  const outlineTags: string[] = [];
  let cursor = 0;
  while ((cursor = opmlText.indexOf('<', cursor)) !== -1) {
    if (opmlText.startsWith('<!--', cursor)) {
      const commentEnd = opmlText.indexOf('-->', cursor + 4);
      cursor = commentEnd === -1 ? opmlText.length : commentEnd + 3;
      continue;
    }
    if (opmlText.startsWith('<![CDATA[', cursor)) {
      const cdataEnd = opmlText.indexOf(']]>', cursor + 9);
      cursor = cdataEnd === -1 ? opmlText.length : cdataEnd + 3;
      continue;
    }
    if (opmlText.startsWith('<!', cursor) || opmlText.startsWith('<?', cursor)) {
      const declarationEnd = opmlText.indexOf('>', cursor + 2);
      cursor = declarationEnd === -1 ? opmlText.length : declarationEnd + 1;
      continue;
    }

    const remainder = opmlText.slice(cursor);
    const closingTag = remainder.match(/^<\/(?:[\w.-]+:)?outline\s*>/i);
    if (closingTag) {
      outlineTags.push(closingTag[0]);
      cursor += closingTag[0].length;
      continue;
    }

    const openingTag = remainder.match(/^<(?:[\w.-]+:)?outline(?=[\s/>])/i);
    if (!openingTag) {
      cursor += 1;
      continue;
    }

    let end = cursor + openingTag[0].length;
    let quote: string | null = null;
    for (; end < opmlText.length; end += 1) {
      const char = opmlText[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        break;
      }
    }
    if (end >= opmlText.length) break;

    outlineTags.push(opmlText.slice(cursor, end + 1));
    cursor = end + 1;
  }

  const folderStack: string[] = [];
  let foundAnyOutline = false;

  for (const tag of outlineTags) {
    foundAnyOutline = true;

    if (/^<\/(?:[\w.-]+:)?outline/i.test(tag)) {
      if (folderStack.length > 0) {
        folderStack.pop();
      }
      continue;
    }

    const isSelfClosing = /\/>$/.test(tag);
    const xmlUrl = getAttr(tag, 'xmlUrl');
    const title = getAttr(tag, 'title') || getAttr(tag, 'text') || '';
    const categoryAttr = getAttr(tag, 'category');
    const curatorCategoriesAttr = getAttr(tag, 'curatorCategories');
    let curatorCategories: string[] | undefined;
    if (curatorCategoriesAttr !== undefined) {
      try {
        const parsedCategories = JSON.parse(curatorCategoriesAttr);
        if (Array.isArray(parsedCategories)) {
          curatorCategories = parsedCategories
            .filter((value: any) => typeof value === 'string')
            .map((value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 40))
            .filter((value: string, index: number, values: string[]) => value && values.findIndex(other => other.toLowerCase() === value.toLowerCase()) === index);
        }
      } catch {
        // Ignore invalid Curator metadata and use the ordinary OPML category below.
      }
    }
    const typeAttr = getAttr(tag, 'type');

    if (xmlUrl !== undefined) {
      const cleanTitle = title || xmlUrl;
      const folder =
        folderStack.length > 0
          ? folderStack[folderStack.length - 1]
          : categoryAttr || 'Uncategorized';

      if (!xmlUrl) {
        failures.push({ title: cleanTitle || 'Unnamed feed', reason: 'Missing feed URL' });
        continue;
      }

      const normalizedUrl = xmlUrl.toLowerCase();
      if (seenUrls.has(normalizedUrl)) {
        continue; // deduplicate identical feeds silently
      }
      seenUrls.add(normalizedUrl);

      let isValidUrl = false;
      try {
        const parsed = new URL(xmlUrl);
        isValidUrl = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        isValidUrl = false;
      }

      if (!isValidUrl) {
        sources.push({
          id: 'src_' + Math.random().toString(36).substring(2, 9),
          title: cleanTitle,
          feedUrl: xmlUrl,
          folder,
          categories: curatorCategories ?? [folder],
          status: 'failing',
          failingReason: 'Invalid feed URL format',
        });
        failures.push({ title: cleanTitle, reason: 'Invalid feed URL format' });
      } else {
        sources.push({
          id: 'src_' + Math.random().toString(36).substring(2, 9),
          title: cleanTitle,
          feedUrl: xmlUrl,
          folder,
          categories: curatorCategories ?? [folder],
          status: 'active',
        });
      }
    } else if (!isSelfClosing) {
      // Container folder outline (e.g. <outline text="Economics" title="Economics">)
      const isRootWrapper =
        !title ||
        title.toLowerCase() === 'subscriptions' ||
        title.toLowerCase() === 'feeds';
      folderStack.push(
        isRootWrapper
          ? folderStack[folderStack.length - 1] || 'Uncategorized'
          : title
      );
    } else if (typeAttr && typeAttr.toLowerCase() === 'rss') {
      // Self-closing RSS outline without xmlUrl
      failures.push({ title: title || 'Unnamed feed', reason: 'Missing xmlUrl attribute' });
    }
  }

  return { sources, failures, foundAnyOutline };
}
