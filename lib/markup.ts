// Feed text cleaning. Feeds are inconsistent about how many times they escape their markup,
// so both cleaners below strip, decode entities, then strip again: a single strip-then-decode
// pass leaves real tags behind (`&lt;p&gt;` survives the strip and becomes `<p>` afterwards),
// which is how raw HTML reached the digest cards and collapsed the reader body into one blob.

// Feeds mix named and numeric XML entities; anything left undecoded renders as "&amp;#8217;"
// style noise in the reader, so decode both, then the literal ampersand last.
export const decodeEntities = (str: string): string =>
  str
    .replace(/&#x([0-9a-f]+);/gi, (entity, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&#(\d+);/g, (entity, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&bull;/gi, '•')
    .replace(/&middot;/gi, '·')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '…')
    .replace(/&rsquo;|&lsquo;/gi, '’')
    .replace(/&rdquo;|&ldquo;/gi, '”')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');

// One line of plain text: for card summaries, titles, dates and feed descriptions.
export const cleanHtml = (str: string): string => {
  if (!str) return '';
  // Strip, decode, strip again. A tag must also open with a letter, slash or bang, so prose
  // like "5 < 10 > 3" is not mistaken for markup and swallowed.
  const withoutTags = (input: string): string =>
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[a-zA-Z/!][^>]*>/g, ' ');

  return withoutTags(decodeEntities(withoutTags(str)))
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Paragraph-shaped plain text for the reader: real paragraphs, no stray lines,
// no promo/repeated boilerplate, no unicode debris.
export const htmlToReadableText = (html: string): string => {
  if (!html) return '';

  const stripMarkup = (input: string): string =>
    input
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
      .replace(/<figure[\s\S]*?<\/figure>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|blockquote|section|article)>/gi, '\n\n')
      .replace(/<li[^>]*>/gi, '\n• ')
      .replace(/<\/li>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ');

  // The second pass matters most here: without it the body reaches the reader as one long
  // paragraph of visible tags instead of prose with real paragraph breaks.
  const decoded = stripMarkup(decodeEntities(stripMarkup(html)));

  return decoded
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    // Only a word that has run into the next one is repaired here. The old rule also fired
    // inside decimals, thousands separators and dotted abbreviations ("1.79", "74,000",
    // "U.S.", "e.g."), which then reached the reader — and the read-aloud voice — in
    // pieces, because a stray full stop reads as the end of a sentence.
    .replace(/([a-z])([,;:])(?=[A-Za-z])/g, '$1$2 ')
    .replace(/([a-z])([.!?])(?=[A-Z][a-z])/g, '$1$2 ')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n{2,}/)
    .map(paragraph => {
      let next = paragraph
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        // Inline tags were stripped to spaces, which leaves "“ defund the police ”"
        .replace(/([“‘(])\s+/g, '$1')
        .replace(/\s+([”’)])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();
      // A stripped inline link can leave a paragraph starting with the punctuation that followed it.
      if (/^[,;:.]/.test(next)) {
        next = next.replace(/^[,;:.]+/, '');
        next = next.charAt(0).toUpperCase() + next.slice(1);
      }
      return next;
    })
    .filter(paragraph => paragraph.length > 0 && /[\p{L}\p{N}]/u.test(paragraph))
    .filter(paragraph => !(paragraph.length < 180 && /^(click here|subscribe|sign up|follow me|read more|share this|advertisement)\b/i.test(paragraph)))
    .filter(paragraph => !/^the post .+ appeared first on /i.test(paragraph))
    .join('\n\n');
};
