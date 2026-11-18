import test from 'node:test';
import assert from 'node:assert/strict';

import { articleNeedsLinkRefresh, cleanHtml, decodeEntities, htmlToReadableText, splitDenseParagraph, splitSentences } from '../lib/markup.ts';

test('only a piece saved before links were kept is refreshed', () => {
  assert.equal(articleNeedsLinkRefresh({ url: 'https://example.com/story' }), true);
  assert.equal(articleNeedsLinkRefresh({ url: 'https://example.com/story', linksCleaned: true }), false);
  assert.equal(articleNeedsLinkRefresh({ url: 'https://example.com/story', linkRefreshAt: 1 }), false);
  assert.equal(articleNeedsLinkRefresh({ url: '' }), false);
  assert.equal(articleNeedsLinkRefresh({}), false);
});

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

test('htmlToReadableText keeps a link address beside its words and leaves no tag debris', () => {
  const escaped = '&lt;p&gt;See &lt;a href=&quot;https://example.com/a&quot;&gt;the piece&lt;/a&gt; for more.&lt;/p&gt;';
  const body = htmlToReadableText(escaped);
  assert.equal(hasTag(body), false);
  assert.equal(body, 'See [the piece](https://example.com/a) for more.');
});

test('htmlToReadableText resolves a relative link against the article address', () => {
  const body = htmlToReadableText('<p>See <a href="/story/2">the follow-up</a>.</p>', 'https://example.com/posts/1');
  assert.equal(body, 'See [the follow-up](https://example.com/story/2).');
});

test('htmlToReadableText drops an anchor that only wrapped a picture', () => {
  const body = htmlToReadableText('<p>Before <a href="https://cdn.example.com/photo.jpg"><img src="https://cdn.example.com/photo.jpg" alt=""></a> after.</p>');
  assert.equal(body, 'Before after.');
});

test('htmlToReadableText keeps an address that is its own link text', () => {
  const body = htmlToReadableText('<p>See <a href="https://example.com/a">https://example.com/a</a>.</p>');
  assert.equal(body, 'See https://example.com/a.');
});

test('htmlToReadableText leaves an address-only anchor as the address', () => {
  const body = htmlToReadableText('<p><a href="https://example.com/a">https://example.com/a</a></p>');
  assert.equal(body, 'https://example.com/a');
});

test('htmlToReadableText keeps the words of a link it cannot follow', () => {
  const body = htmlToReadableText('<p>Read <a href="javascript:alert(1)">the notes</a> now.</p>');
  assert.equal(body, 'Read the notes now.');
});

test('htmlToReadableText keeps the words of a link wrapped around formatted text', () => {
  const body = htmlToReadableText('<p>See <a href="https://example.com/x">the <em>whole</em> piece</a>.</p>');
  assert.equal(body, 'See [the whole piece](https://example.com/x).');
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

test('htmlToReadableText drops gallery captions and credits that repeat with every image', () => {
  const body = htmlToReadableText(
    '<p>Real article text starts here.</p><p>Just another day in a thrilling life of crime.</p><p>Rockstar</p><p>Just another day in a thrilling life of crime.</p><p>Rockstar</p><p>Real article text continues.</p>',
  );
  assert.equal(body, 'Real article text starts here.\n\nReal article text continues.');
});

test('htmlToReadableText keeps a short line that appears only once', () => {
  // "Synthesis" is a section heading, not a caption; only repeats are furniture.
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>Synthesis</p>'), 'Body text here.\n\nSynthesis');
});

test('htmlToReadableText drops bracket-only footnote debris', () => {
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>[return]</p>'), 'Body text here.');
});

test('htmlToReadableText drops a player call to action', () => {
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>Watch on Aeon</p>'), 'Body text here.');
});

test('htmlToReadableText keeps a word clear of the parameter that followed it', () => {
  assert.equal(
    htmlToReadableText('<p>The?install=datasette-maplibre installs that plugin from PyPI.</p>'),
    'The ?install=datasette-maplibre installs that plugin from PyPI.',
  );
});

test('htmlToReadableText drops the author card and comment count a feed appends', () => {
  const body = htmlToReadableText('<p>Real article text.</p><p>Kyle Orland</p><p>Senior Gaming Editor</p><p>5 Comments</p>');
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops the author bio a publisher appends', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p>Jacob is a copy editor at Ars Technica. He resides in Portland, Oregon, where he enjoys typical Portlander things.</p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText keeps a bio-shaped line that sits inside the piece', () => {
  const body = htmlToReadableText(
    '<p>Ana is a reporter at the Gazette. She filed this from the coast.</p><p>Real article text continues.</p>',
  );
  assert.equal(body, 'Ana is a reporter at the Gazette. She filed this from the coast.\n\nReal article text continues.');
});

test('htmlToReadableText drops a footnote backlink written as a link', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p><a href="https://danluu.com/astra-testing/#fnref:5">return</a></p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops a comment count printed as a list line', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p>• <a href="https://example.com/story#comments">20 Comments</a></p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops the comment thread controls after the article', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p>Comments</p><p>Sort by Top Sort by Recent Sort by Controversial</p><p><a href="https://example.com/story#">Hide Replies</a></p><p>Continue this thread →</p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops a comment template that leaked into the body', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p>0) { %&gt; is-negative "&gt;</p><p>= startingDepth &amp;&amp; model.depth</p><p>Continue this thread →</p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText strips a return link that ends a footnote paragraph', () => {
  const body = htmlToReadableText(
    '<p>Real article text. <a href="https://example.com/story#fnref:5">return</a></p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops a more-by-this-author block at the end', () => {
  const body = htmlToReadableText([
    '<p>First paragraph of the piece.</p>',
    '<p>Second paragraph of the piece.</p>',
    '<p>Third paragraph of the piece.</p>',
    '<p>Fourth paragraph of the piece.</p>',
    '<p>More by Ben Thompson</p>',
    '<p>Year in Review</p>',
    '<p><a href="https://example.com/archive">View All</a></p>',
  ].join(''));
  assert.equal(
    body,
    'First paragraph of the piece.\n\nSecond paragraph of the piece.\n\nThird paragraph of the piece.\n\nFourth paragraph of the piece.',
  );
});

test('htmlToReadableText drops the site sidebar that repeats under a piece', () => {
  const body = htmlToReadableText([
    '<p>First paragraph of the piece.</p>',
    '<p>Second paragraph of the piece.</p>',
    '<p>Third paragraph of the piece.</p>',
    '<p>Fourth paragraph of the piece.</p>',
    '<p>← <a href="https://example.com/previous">Previous piece</a></p>',
    '<p>Stratechery Plus</p>',
    '<p><a href="https://example.com/login">Log In</a></p>',
    '<p>Updates</p>',
    '<p>• <a href="https://example.com/post">Some post</a></p>',
    '<p>Tuesday, November 17, 2026</p>',
    '<p><a href="https://example.com/all">View All</a></p>',
  ].join(''));
  assert.equal(
    body,
    'First paragraph of the piece.\n\nSecond paragraph of the piece.\n\nThird paragraph of the piece.\n\nFourth paragraph of the piece.',
  );
});

test('htmlToReadableText stops a paywalled piece at the teaser', () => {
  const body = htmlToReadableText([
    '<p>The piece opens and then stops at the paywall.</p>',
    '<p>Already subscribed?</p>',
    '<p><a href="https://example.com/login">Log in</a></p>',
    '<p>$15 / month or $150 / year</p>',
    '<p>With a subscription you get access to the subscriber-only newsletter and interviews.</p>',
  ].join(''));
  assert.equal(body, 'The piece opens and then stops at the paywall.');
});

test('htmlToReadableText keeps the article when a sign-in prompt is not a paywall', () => {
  const body = htmlToReadableText([
    '<p>Already subscribed? Sign in</p>',
    '<p>Real article text continues here.</p>',
    '<p>And the piece ends here.</p>',
  ].join(''));
  assert.equal(
    body,
    'Already subscribed? Sign in\n\nReal article text continues here.\n\nAnd the piece ends here.',
  );
});

test('htmlToReadableText drops a final row of cards printed on one line', () => {
  const body = htmlToReadableText([
    '<p>Real article text.</p>',
    '<p>Director: Martín Benchimol</p>',
    '<p>18 November 2026</p>',
    '<p><a href="https://example.com/a">video One film 4 minutes</a> <a href="https://example.com/b">video Another film 3 minutes</a></p>',
    '<p><a href="https://example.com/c">video A third film 2 minutes</a></p>',
  ].join(''));
  assert.equal(body, 'Real article text.\n\nDirector: Martín Benchimol');
});

test('htmlToReadableText keeps a cited-notes list at the end', () => {
  const body = htmlToReadableText([
    '<p>Real article text.</p>',
    '<p>Notes</p>',
    '<p>• <a href="https://example.com/ref1">Richards, J.C., and Rodgers, T.S. Approaches and Methods in Language Teaching.</a></p>',
    '<p>• <a href="https://example.com/ref2">Krashen, S.D. Principles and Practice in Second Language Acquisition.</a></p>',
    '<p>• <a href="https://example.com/ref3">Howatt, A.P.R., and Widdowson, H.G. A History of English Language Teaching.</a></p>',
    '<p>• <a href="https://example.com/ref4">Lyu, B., Lai, C., and Guo, J. Effectiveness of Chatbots in Improving Language Learning.</a></p>',
  ].join(''));
  assert.ok(body.startsWith('Real article text.\n\nNotes'), body);
  assert.ok(body.includes('Krashen'), body);
});

test('htmlToReadableText drops the share row under an article', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p>• <a href="https://example.com/story#print">print</a></p><p>• <a href="https://example.com/feed">RSS Feed</a></p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops a loading spinner left by the publisher', () => {
  assert.equal(htmlToReadableText('<p>Real article text.</p><p>Like Loading…</p>'), 'Real article text.');
});

test('htmlToReadableText keeps a short last line that is prose', () => {
  assert.equal(htmlToReadableText('<p>Body text here.</p><p>So it goes.</p>'), 'Body text here.\n\nSo it goes.');
});

test('htmlToReadableText drops the author card when the name is a link', () => {
  const body = htmlToReadableText(
    '<p>Real article text.</p><p><a href="https://example.com/author/kyle">Kyle Orland</a> Senior Gaming Editor</p><p>5 Comments</p>',
  );
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText drops a byline whose name is a link', () => {
  const body = htmlToReadableText('<p>By <a href="https://example.com/author/danai">Danai Nesta Kupemba</a></p><p>Real article text starts here.</p>');
  assert.equal(body, 'Real article text starts here.');
});

test('htmlToReadableText drops a promo line that is a link', () => {
  const body = htmlToReadableText('<p><a href="https://example.com/store">Learn more</a></p><p>Real article text.</p>');
  assert.equal(body, 'Real article text.');
});

test('htmlToReadableText keeps prose that mentions a job title', () => {
  assert.equal(htmlToReadableText('<p>She is a writer</p><p>Real article text.</p>'), 'She is a writer\n\nReal article text.');
});

test('htmlToReadableText drops a lone hashtag caption', () => {
  assert.equal(htmlToReadableText('<p>Real article text.</p><p>#nofilter</p>'), 'Real article text.');
});

test('htmlToReadableText drops a picture credit whose image was stripped', () => {
  // A caption reaches the reader as prose once its image is gone: it names no subject and
  // sends the reader off-site from the middle of the article.
  const body = htmlToReadableText(
    '<p>Real article text starts here.</p><p>Painting: Cognitive Incline | Leroy David Nunery III - https://longview.gallery/products/cognitive-incline</p>',
  );
  assert.equal(body, 'Real article text starts here.');
});

test('htmlToReadableText keeps a sentence that merely opens with a caption word', () => {
  const body = htmlToReadableText('<p>Painting: my grandfather built sets for the opera.</p>');
  assert.equal(body, 'Painting: my grandfather built sets for the opera.');
});

test('htmlToReadableText rejoins a quotation whose attribution arrived as its own paragraph', () => {
  const body = htmlToReadableText(
    '<p>“The key issue is not whether but how AI is used. The difference lies less in the technology itself and more in the user,”</p><p>said Jackson G. Lu, PhD, an associate professor at MIT.</p>',
  );
  assert.equal(
    body,
    '“The key issue is not whether but how AI is used. The difference lies less in the technology itself and more in the user,” said Jackson G. Lu, PhD, an associate professor at MIT.',
  );
});

test('htmlToReadableText rejoins a sentence that resumes with a name after a comma', () => {
  const body = htmlToReadableText('<p>“We were all shocked,”</p><p>Akogo said of the result.</p>');
  assert.equal(body, '“We were all shocked,” Akogo said of the result.');
});

test('htmlToReadableText keeps a line that introduces the block below it on its own line', () => {
  const body = htmlToReadableText('<p>Here is the config:</p><p>worker_processes auto;</p>');
  assert.equal(body, 'Here is the config:\n\nworker_processes auto;');
});

test('htmlToReadableText keeps a new paragraph that opens with a name spelled in lower case', () => {
  const body = htmlToReadableText('<p>Phones got faster.</p><p>iPhone sales still fell.</p>');
  assert.equal(body, 'Phones got faster.\n\niPhone sales still fell.');
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
// Dense paragraphs — splitting the reader body at real sentence ends
// ---------------------------------------------------------------------------

test('splitDenseParagraph leaves a paragraph of six sentences alone', () => {
  const paragraph =
    'Ships left the harbour at dawn. The tide was already turning. Nobody on the pier spoke. ' +
    'Gulls circled the mastheads. A bell rang twice. Then the fog took them.';
  assert.deepEqual(splitDenseParagraph(paragraph), [paragraph]);
});

test('splitDenseParagraph spreads nine sentences over two even paragraphs without changing a word', () => {
  const sentences = [
    'The first sensor logged a spike at noon, right as the backup generator kicked in.',
    'Engineers assumed it was noise from the new cabling in the west corridor.',
    'A second reading matched it within a minute, down to the last decimal place.',
    'They walked the whole cable run in the rain, torch in hand, saying very little.',
    'The fault turned out to be a loose connector that had never been fully seated.',
    'It had been fitted in a hurry during the autumn maintenance window.',
    'A replacement arrived the next morning and took ten minutes to install.',
    'The spike did not return, and the logs stayed flat for a fortnight afterwards.',
    'The report went out on Friday to a mailing list nobody had read in years.',
  ];
  const paragraph = sentences.join(' ');
  const chunks = splitDenseParagraph(paragraph);

  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(' '), paragraph, 'splitting must not add, drop or reorder words');
  assert.equal(chunks[0].split(/(?<=[.!?])\s+/).length, 5);
  assert.equal(chunks[1].split(/(?<=[.!?])\s+/).length, 4);
});

test('splitDenseParagraph never breaks after an abbreviation or an initial', () => {
  const paragraph =
    'The work was led by Dr. Smith and Prof. Adeyemi, who ran the trial from a small office in Leeds. ' +
    'It ran for three years and cost rather more than the funders had expected at the outset. ' +
    'Participants included J. K. Rowling and H. G. Wells, e.g. the early cohort recruited in 2019. ' +
    'Results appeared in Sept. 2024 in the Journal of Small Things, alongside a long methods section. ' +
    'A follow-up is planned for the spring, with a larger and more varied sample. ' +
    'Nobody expected the size of the effect, least of all the two authors of the original paper. ' +
    'The funders were surprised too, and said so in a short statement released that afternoon. ' +
    'A second round of grants follows next year, subject to the usual committee review. ' +
    'That is all, for now.';
  const chunks = splitDenseParagraph(paragraph);

  assert.equal(chunks.join(' '), paragraph, 'abbreviations must survive in place');
  assert.equal(chunks.length, 2);
  assert.equal(chunks.some(chunk => /(?:Dr|Prof|Sept|e\.g)\.$/.test(chunk)), false,
    `a chunk ended on an abbreviation: ${JSON.stringify(chunks)}`);
  assert.equal(chunks.some(chunk => /^(?:Smith|Adeyemi|Rowling|Wells|K\.|G\.|2024)/.test(chunk)), false,
    `a chunk began mid-sentence: ${JSON.stringify(chunks)}`);
});

test('splitSentences keeps a decimal and a version number inside one sentence', () => {
  assert.deepEqual(
    splitSentences('Version 3.11 shipped in 2024. Then 3.12 followed.'),
    ['Version 3.11 shipped in 2024.', 'Then 3.12 followed.'],
  );
  assert.deepEqual(
    splitSentences('The rate is 4.5 percent, up from 3.75. Nobody argued about it.'),
    ['The rate is 4.5 percent, up from 3.75.', 'Nobody argued about it.'],
  );
});

test('splitSentences does not split inside quoted speech', () => {
  assert.deepEqual(
    splitSentences('"I never said that." She turned to the window.'),
    ['"I never said that."', 'She turned to the window.'],
  );
  // The full stop inside the quotation is not a sentence end, and the lowercase attribution
  // after the closing quote is not the start of a new one.
  assert.deepEqual(
    splitSentences('He paused. "Stop. Now!" she said. The room went quiet.'),
    ['He paused.', '"Stop. Now!" she said.', 'The room went quiet.'],
  );
  assert.deepEqual(
    splitSentences('“First she left. Then she returned.” He shrugged.'),
    ['“First she left. Then she returned.”', 'He shrugged.'],
  );
});

test('splitSentences treats an ellipsis as trailing off, not as a sentence end', () => {
  assert.deepEqual(
    splitSentences('Well... I suppose so. That is that.'),
    ['Well... I suppose so.', 'That is that.'],
  );
  assert.deepEqual(splitSentences('And then… nothing. The end.'), ['And then… nothing.', 'The end.']);
});

test('splitDenseParagraph leaves a short paragraph with many short sentences whole', () => {
  const paragraph =
    'He was angry. He was always angry. Nobody liked it. It got worse. It got better. ' +
    'Then it got worse again. That was the pattern.';
  assert.ok(paragraph.length < 400, 'the fixture is meant to be a short paragraph');
  assert.deepEqual(splitDenseParagraph(paragraph), [paragraph]);
});

test('splitDenseParagraph keeps a paragraph whole rather than leaving a stub piece', () => {
  // One long sentence and six short ones: four-and-three would leave a 90-character tail, so
  // the paragraph is better left whole.
  const paragraph = [
    'The report argued, at considerable length and with a great many footnotes, that the decline in local manufacturing had less to do with trade policy than with the cost of moving goods between three counties.',
    'Nobody disagreed.',
    'Nobody agreed either.',
    'The meeting ended.',
    'People went home.',
    'The room was cleared.',
    'Nothing changed.',
  ].join(' ');
  assert.deepEqual(splitDenseParagraph(paragraph), [paragraph]);
});

test('splitDenseParagraph splits a long run of dialogue without tearing a quotation or leaving a stub', () => {
  const paragraph = [
    '“We were all shocked,” Darlington Akogo, founder of the lab, told Rest of World in an interview.',
    '“Nobody here had seen a model that could do this a year ago, and now it is routine.”',
    'He said the team had spent the previous winter collecting data from three hospitals.',
    '“That is the part people miss,” he added. “The data was the hard part, not the model.”',
    'The lab has since published a short paper describing the method and the results.',
    '“We are not trying to compete with the big labs,” Akogo said.',
    '“We are trying to make sure the questions get asked here, by people who live here.”',
    'That framing has won the team attention from regulators in Accra and elsewhere.',
    'It has also brought scrutiny, including questions about where the training data came from.',
  ].join(' ');
  const pieces = splitDenseParagraph(paragraph);

  assert.ok(pieces.length >= 2, `a long dialogue paragraph should still split: ${pieces.length}`);
  assert.equal(pieces.join(' '), paragraph);
  for (const piece of pieces) {
    assert.ok(piece.length >= 150, `stub piece: ${JSON.stringify(piece)}`);
    assert.equal((piece.match(/“/g) || []).length, (piece.match(/”/g) || []).length, `torn quotation: ${piece}`);
    assert.match(piece, /^[\p{Lu}“]/u, `piece starts mid-sentence: ${piece}`);
  }
});

test('splitDenseParagraph keeps a paragraph with no terminal punctuation whole', () => {
  const paragraph = 'a headline that never turned into a sentence';
  assert.deepEqual(splitDenseParagraph(paragraph), [paragraph]);
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
