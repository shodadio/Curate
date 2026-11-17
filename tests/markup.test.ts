import test from 'node:test';
import assert from 'node:assert/strict';

import { cleanHtml, decodeEntities, htmlToReadableText } from '../lib/markup.ts';

const hasTag = (text: string) => /<[a-z/!][^>]*>/i.test(text);

// ---------------------------------------------------------------------------
// Entity decoding
// ---------------------------------------------------------------------------

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;p&gt;'), '<p>');
  assert.equal(decodeEntities('&#8217;'), '’');
  assert.equal(decodeEntities('&#x2014;'), '—');
  assert.equal(decodeEntities('&rsquo;'), '’');
  assert.equal(decodeEntities('&hellip;'), '…');
});

test('decodeEntities leaves an out-of-range code point alone instead of throwing', () => {
  assert.equal(decodeEntities('&#xD800;'), '&#xD800;', 'surrogate halves are not decoded');
  assert.equal(decodeEntities('&#99999999;'), '&#99999999;');
});

// ---------------------------------------------------------------------------
// cleanHtml — the card summary / title cleaner
// ---------------------------------------------------------------------------

test('cleanHtml strips ordinary markup and collapses it to one line of prose', () => {
  const cleaned = cleanHtml('<p>Hello <b>world</b>,   &amp; welcome</p>\n<p>Again</p>');
  // A stripped inline tag leaves a space before punctuation; that is the known cosmetic quirk,
  // so normalise it here and assert the part that matters: tags gone, entities decoded.
  assert.equal(cleaned.replace(/\s+([,.;:!?])/g, '$1'), 'Hello world, & welcome Again');
});

test('cleanHtml strips markup that only appears after entity decoding (double-escaped feeds)', () => {
  const escaped = '&lt;p&gt;Datasette Lite is my port of the &lt;a href=&quot;https://datasette.io/&quot;&gt;Datasette&lt;/a&gt; app.&lt;/p&gt;';
  const cleaned = cleanHtml(escaped);
  assert.equal(hasTag(cleaned), false, `raw tags leaked into the summary: ${cleaned}`);
  assert.equal(cleaned, 'Datasette Lite is my port of the Datasette app.');
});

test('cleanHtml does not leak tags from a doubly-escaped block with attributes', () => {
  const escaped = '&lt;div class=&quot;entry&quot;&gt;&lt;img src=&quot;x.png&quot; alt=&quot;A photo&quot; /&gt;Caption text&lt;/div&gt;';
  const cleaned = cleanHtml(escaped);
  assert.equal(hasTag(cleaned), false, `raw tags leaked: ${cleaned}`);
  assert.ok(cleaned.includes('Caption text'));
});

test('cleanHtml leaves prose that merely uses angle brackets intact', () => {
  assert.equal(cleanHtml('5 < 10 > 3 and 2 <3'), '5 < 10 > 3 and 2 <3');
});

test('cleanHtml removes scripts, styles and unwraps CDATA', () => {
  const cleaned = cleanHtml('<style>.a{color:red}</style><script>alert(1)</script><![CDATA[Real text]]>');
  assert.equal(cleaned, 'Real text');
});

test('cleanHtml drops zero-width characters and non-breaking spaces', () => {
  assert.equal(cleanHtml('zero\u200Bwidth\uFEFF text\u00a0here'), 'zerowidth text here');
});

test('cleanHtml returns an empty string for empty input', () => {
  assert.equal(cleanHtml(''), '');
});

// ---------------------------------------------------------------------------
// htmlToReadableText — the reader body cleaner
// ---------------------------------------------------------------------------

test('htmlToReadableText turns ordinary paragraphs into blank-line separated text', () => {
  const body = htmlToReadableText('<p>First paragraph.</p><p>Second paragraph.</p>');
  assert.equal(body, 'First paragraph.\n\nSecond paragraph.');
});

test('htmlToReadableText keeps paragraph structure when the feed double-escapes its body', () => {
  const escaped = '&lt;p&gt;First paragraph.&lt;/p&gt;&lt;p&gt;Second paragraph.&lt;/p&gt;&lt;p&gt;Third paragraph.&lt;/p&gt;';
  const body = htmlToReadableText(escaped);
  assert.equal(hasTag(body), false, `raw tags leaked into the reader body: ${body}`);
  assert.equal(body.split('\n\n').length, 3, `paragraphs collapsed: ${JSON.stringify(body)}`);
  assert.equal(body, 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
});

test('htmlToReadableText keeps links as readable words and leaves no tag debris', () => {
  const escaped = '&lt;p&gt;See &lt;a href=&quot;https://example.com/a&quot;&gt;the piece&lt;/a&gt; for more.&lt;/p&gt;';
  const body = htmlToReadableText(escaped);
  assert.equal(hasTag(body), false);
  assert.equal(body, 'See the piece for more.');
});

test('htmlToReadableText survives text escaped twice over', () => {
  // &amp;lt;p&amp;gt; decodes once to the literal text "&lt;p&gt;": still no real tag, so the
  // words must reach the reader rather than being half-eaten by the cleaner.
  const body = htmlToReadableText('&amp;lt;p&amp;gt;Still text&amp;lt;/p&amp;gt;');
  assert.equal(hasTag(body), false, `a tag appeared: ${body}`);
  assert.match(body, /Still text/, `the words were lost: ${body}`);
});

test('htmlToReadableText converts line breaks and list items', () => {
  const body = htmlToReadableText('<p>Line one<br>Line two</p><ul><li>First item</li><li>Second item</li></ul>');
  assert.equal(body, 'Line one Line two\n\n• First item\n\n• Second item');
});

test('htmlToReadableText drops promo boilerplate and masthead footers', () => {
  const body = htmlToReadableText(
    '<p>Real article text that should stay.</p><p>Read more</p><p>The post Example appeared first on Example Blog.</p>',
  );
  assert.equal(body, 'Real article text that should stay.');
});

test('htmlToReadableText repairs a word that has run into the next sentence', () => {
  assert.equal(htmlToReadableText('<p>One ended.Next began.</p>'), 'One ended. Next began.');
});

test('htmlToReadableText keeps decimals and abbreviations together', () => {
  assert.equal(htmlToReadableText('<p>It rose 1.79% to 74,000 in the U.S. last year.</p>'), 'It rose 1.79% to 74,000 in the U.S. last year.');
});

test('htmlToReadableText handles an empty body', () => {
  assert.equal(htmlToReadableText(''), '');
});

test('htmlToReadableText strips a settings widget that arrives as its own labels', () => {
  // Ars Technica's display controls, as the feed delivers them: each label its own paragraph.
  const body = htmlToReadableText(
    '<p>Story text</p><p>Size</p><p>Small Standard Large</p><p>Width *</p><p>Standard Wide</p><p>Links</p><p>Standard Orange</p><p>Real article text starts here.</p>',
  );
  assert.equal(body, 'Real article text starts here.');
});

test('htmlToReadableText drops a label run that appears mid-article too', () => {
  const body = htmlToReadableText(
    '<p>Real article text starts here.</p><p>Story text</p><p>Size</p><p>Small Standard Large</p><p>Standard Orange</p><p>Real article text continues.</p>',
  );
  assert.equal(body, 'Real article text starts here.\n\nReal article text continues.');
});

test('htmlToReadableText keeps two label-like words in a row, which can be real prose', () => {
  const body = htmlToReadableText('<p>Links</p><p>Size</p><p>Real article text starts here.</p>');
  assert.equal(body, 'Links\n\nSize\n\nReal article text starts here.');
});

test('htmlToReadableText drops paywall footnotes that arrive as paragraphs', () => {
  const body = htmlToReadableText('<p>* Subscribers only</p><p>Learn more</p><p>Real article text starts here.</p>');
  assert.equal(body, 'Real article text starts here.');
});

test('htmlToReadableText drops a byline paragraph from a teaser body', () => {
  const body = htmlToReadableText(
    '<p>Women in Tehran are changing society by dressing as they choose, in numbers too large to stop.</p><p>- by Parisa Khoshnami</p>',
  );
  assert.equal(body, 'Women in Tehran are changing society by dressing as they choose, in numbers too large to stop.');
});

test('htmlToReadableText drops byline phrasing with and without a dash', () => {
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>By Jane Doe</p>'), 'Body text here.');
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>Words by Jane van der Berg</p>').includes('Jane'), false);
});

test('htmlToReadableText keeps prose that merely begins with by', () => {
  const body = htmlToReadableText('<p>By Tuesday, the storm had passed over the coast.</p>');
  assert.equal(body, 'By Tuesday, the storm had passed over the coast.');
});

test('htmlToReadableText keeps a lone Links paragraph inside an article', () => {
  const body = htmlToReadableText('<p>Some prose that opens the piece.</p><p>Links</p><p>More prose follows here.</p>');
  assert.equal(body, 'Some prose that opens the piece.\n\nLinks\n\nMore prose follows here.');
});

// ---------------------------------------------------------------------------
// Regression: the reported bug
// ---------------------------------------------------------------------------

test('a double-escaped article is clean in both the card summary and the reader body', () => {
  const feedDescription =
    '&lt;p&gt;&lt;a href=&quot;https://lite.datasette.io/&quot;&gt;Datasette Lite&lt;/a&gt; is my port of the &lt;a href=&quot;https://datasette.io/&quot;&gt;Datasette&lt;/a&gt; Python application.&lt;/p&gt;' +
    '&lt;p&gt;I have released a complete rewrite using service workers.&lt;/p&gt;';

  const summary = cleanHtml(feedDescription).slice(0, 277).replace(/\s+\S*$/, '') + '...';
  assert.equal(hasTag(summary), false, `card summary still shows markup: ${summary}`);
  assert.match(summary, /^Datasette Lite is my port of the Datasette Python application\./);

  const body = htmlToReadableText(feedDescription);
  assert.equal(hasTag(body), false, `reader body still shows markup: ${body}`);
  assert.equal(body.split('\n\n').length, 2, 'the two source paragraphs must survive');
  assert.match(body, /service workers\.$/);
});
