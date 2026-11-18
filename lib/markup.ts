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

// Site chrome: display-settings widgets in the publisher's page reach feeds as a run of very
// short paragraphs (Ars Technica's "Story text / Size / Small Standard Large / Width * /
// Standard Wide / Links / Standard Orange"), which then read as the opening of the article.
// A single short "Links" paragraph can be genuine prose, so labels are only dropped when at
// least three in a row match.
const chromeLabel = /^(?:[•*·]\s*)?(?:story text|story text size|text size|font size|line height|size|small|small standard large|standard large|width\s*\*?|standard wide|wide|links?|standard (?:orange|blue|green|white|black)|dark mode|light mode|reader mode|reading mode)$/i;

const dropChromeRuns = (paragraphs: string[]): string[] => {
  const isLabel = (paragraph: string) => paragraph.length <= 30 && chromeLabel.test(paragraph);
  const kept: string[] = [];

  for (let index = 0; index < paragraphs.length; index++) {
    if (!isLabel(paragraphs[index])) {
      kept.push(paragraphs[index]);
      continue;
    }
    let runEnd = index;
    while (runEnd < paragraphs.length && isLabel(paragraphs[runEnd])) runEnd++;
    if (runEnd - index < 3) kept.push(...paragraphs.slice(index, runEnd));
    index = runEnd - 1;
  }

  return kept;
};

// Teaser feeds hand over a standfirst with its byline still attached as its own paragraph
// ("- by Parisa Khoshnami"). A byline is "by" plus a few capitalised names and nothing else,
// so prose that merely starts with "By Tuesday, ..." is left alone.
const bylineParagraph = /^(?:[-–—•*]\s*)?(?:by|words by|story by|written by|text by)\s+\p{Lu}[\p{L}'’.-]*(?:\s+(?:\p{Lu}[\p{L}'’.-]*|van|von|der|de|del|della|da|di|la|le|bin|al)){0,5}\.?$/iu;

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

  const paragraphs = decoded
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
    .filter(paragraph => !(paragraph.length < 180 && /^(click here|subscribe|sign up|follow me|read more|read on|learn more|share this|advertisement)\b/i.test(paragraph)))
    // "* Subscribers only" and its siblings are paywall footnotes, not article text.
    .filter(paragraph => !/^\*?\s*(?:subscribers?|members?)\s*only\.?$/i.test(paragraph))
    .filter(paragraph => !(paragraph.length <= 60 && bylineParagraph.test(paragraph)))
    .filter(paragraph => !/^the post .+ appeared first on /i.test(paragraph));

  return dropChromeRuns(paragraphs).join('\n\n');
};

// ---- Dense paragraphs --------------------------------------------------------
// Some publishers put a whole section in a single <p>, which reaches the reader as one wall of
// text. The reader shows that as a few shorter paragraphs instead, but only at a real sentence
// end: a full stop after an abbreviation, inside quoted speech or in a decimal is not one.

const SENTENCE_ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'ft', 'vs', 'etc', 'al', 'fig', 'figs',
  'no', 'nos', 'vol', 'vols', 'pp', 'ch', 'sec', 'cf', 'approx', 'ca', 'inc', 'ltd', 'co', 'corp',
  'dept', 'univ', 'gen', 'col', 'lt', 'sgt', 'capt', 'rev', 'hon', 'pres', 'gov', 'sen', 'rep',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
  'mon', 'tue', 'tues', 'wed', 'thu', 'thur', 'fri', 'sat', 'sun',
  'am', 'pm', 'ad', 'bc', 'bce', 'ce', 'esq', 'messrs', 'mme', 'mlle', 'trans', 'eds', 'repr',
]);

// Dotted forms are matched as written, so "U.S." cannot be confused with the word "us".
const DOTTED_ABBREVIATIONS = new Set([
  'u.s', 'u.k', 'e.u', 'u.n', 'd.c', 'a.m', 'p.m', 'ph.d', 'm.d', 'e.g', 'i.e', 'b.a', 'm.a',
  'b.sc', 'm.sc', 'a.d', 'op.cit',
]);

// A candidate end of sentence: punctuation, any closing quotes or brackets, then the whitespace
// that settles where the next sentence would begin.
const SENTENCE_END = /[.!?]+["'”’)\]]*\s+/g;
// Only a capital, a digit, a quote or an opening bracket can start the next sentence; anything
// else ("e.g. this") means the full stop was not a sentence end.
const STARTS_SENTENCE = /[\p{Lu}\p{N}"“'‘(\[]/u;

const isAbbreviatedStop = (textBeforeStop: string): boolean => {
  const token = /([^\s"'“”‘’()\[\]]+)$/.exec(textBeforeStop)?.[1] ?? '';
  if (!token) return false;
  // A lone letter is an initial ("J. K. Rowling"), never a sentence end.
  if ([...token].length === 1) return true;
  const lower = token.toLowerCase();
  return lower.includes('.') ? DOTTED_ABBREVIATIONS.has(lower) : SENTENCE_ABBREVIATIONS.has(lower);
};

// Straight quotes alternate; curly quotes know which side they are. A lone apostrophe is skipped
// so "don’t" does not look like the start of a quotation.
const quoteDepth = (text: string): number => {
  let depth = 0;
  for (const character of text) {
    if (character === '"') depth = depth === 0 ? 1 : 0;
    else if (character === '“') depth += 1;
    else if (character === '”' && depth > 0) depth -= 1;
  }
  return depth;
};

/** Splits prose at real sentence ends, leaving abbreviations, quotes and decimals intact. */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  const sentences: string[] = [];
  let start = 0;
  SENTENCE_END.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END.exec(text)) !== null) {
    const punctuation = match[0].replace(/[\s"'”’)\]]+$/, '');
    // "..." and "…" trail off rather than end a sentence.
    if (/\.{2,}|…/.test(punctuation)) continue;

    const nextIndex = match.index + match[0].length;
    const next = text[nextIndex];
    if (!next || !STARTS_SENTENCE.test(next)) continue;
    if (punctuation.endsWith('.') && isAbbreviatedStop(text.slice(0, match.index))) continue;
    // Closing quotes count, so '"Go home." She left.' still splits after the spoken sentence.
    if (quoteDepth(text.slice(0, nextIndex)) !== 0) continue;

    const sentence = text.slice(start, nextIndex).trim();
    if (sentence) sentences.push(sentence);
    start = nextIndex;
  }

  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

const DENSE_PARAGRAPH_SENTENCE_LIMIT = 6;
// A paragraph this short is already a few lines on a phone, however many sentences it holds;
// cutting it would make two stubs rather than short paragraphs.
const DENSE_MIN_PARAGRAPH_CHARS = 400;
// A piece smaller than this reads as a leftover line, so it is merged into a neighbour instead.
const DENSE_MIN_PIECE_CHARS = 150;

/** Folds any stub piece into its shortest neighbour until every piece is a real paragraph. */
const mergeStubPieces = (pieces: string[], minChars: number): string[] => {
  const merged = [...pieces];
  let stub = merged.findIndex(piece => piece.length < minChars);

  while (stub !== -1 && merged.length > 1) {
    // Join the shorter neighbour, so the remaining pieces stay as even as the text allows.
    const takePrevious = stub === merged.length - 1
      || (stub > 0 && merged[stub - 1].length <= merged[stub + 1].length);
    const neighbour = takePrevious ? stub - 1 : stub + 1;
    const first = Math.min(stub, neighbour);
    merged.splice(first, 2, `${merged[first]} ${merged[first + 1]}`);
    stub = merged.findIndex(piece => piece.length < minChars);
  }

  return merged;
};

/**
 * Breaks a dense paragraph into shorter ones, or returns it untouched when it is already short.
 * Sentences are spread evenly over the fewest paragraphs that fit the limit, so eight sentences
 * become 4 + 4 rather than one long block and one short one. A piece that would come out as a
 * stub is merged back, and a paragraph too short to divide well is left alone. The words are
 * never changed, and a boundary is only ever a sentence end, so quotations stay whole.
 */
export function splitDenseParagraph(
  paragraph: string,
  sentenceLimit = DENSE_PARAGRAPH_SENTENCE_LIMIT,
): string[] {
  if (paragraph.length < DENSE_MIN_PARAGRAPH_CHARS) return [paragraph];

  const sentences = splitSentences(paragraph);
  if (sentences.length <= sentenceLimit) return [paragraph];

  const paragraphCount = Math.ceil(sentences.length / sentenceLimit);
  const base = Math.floor(sentences.length / paragraphCount);
  const extra = sentences.length % paragraphCount;

  const chunks: string[] = [];
  let cursor = 0;
  for (let index = 0; index < paragraphCount; index++) {
    const size = base + (index < extra ? 1 : 0);
    chunks.push(sentences.slice(cursor, cursor + size).join(' '));
    cursor += size;
  }

  const balanced = mergeStubPieces(chunks, DENSE_MIN_PIECE_CHARS);
  return balanced.length > 1 ? balanced : [paragraph];
}
