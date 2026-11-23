import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArticleAuthor, parseFeedChannelDescription, parseFeedItemAuthor, parseFeedSiteUrl, parseSitePageDescription } from '../lib/sourceMetadata.ts';

test('reads the channel description without mistaking an article description for it', () => {
  const feed = '<rss><channel><title>Example</title><description><![CDATA[<p>A journal about science and society.</p>]]></description><item><description>Article excerpt</description></item></channel></rss>';
  assert.equal(parseFeedChannelDescription(feed), 'A journal about science and society.');
});

test('a publication blurb in Markdown loses its syntax before it reaches the page', () => {
  const feed = '<rss><channel><description>Essays on [markets](https://example.com) and **growth**.</description></channel></rss>';
  assert.equal(parseFeedChannelDescription(feed), 'Essays on markets and growth.');
});

test('reads an Atom subtitle and returns an empty description when feed metadata is absent', () => {
  assert.equal(parseFeedChannelDescription('<feed><subtitle>Independent reporting from the region.</subtitle><entry/></feed>'), 'Independent reporting from the region.');
  assert.equal(parseFeedChannelDescription('<rss><channel><item><description>Article only</description></item></channel></rss>'), '');
});

test('prefers an alternate site link and safely falls back to the feed origin', () => {
  assert.equal(
    parseFeedSiteUrl('<feed><link rel="self" href="https://example.com/feed.xml"/><link rel="alternate" href="https://example.com/about"/><entry/></feed>', 'https://example.com/feed.xml'),
    'https://example.com/about'
  );
  assert.equal(parseFeedSiteUrl('<rss><channel></channel></rss>', 'https://example.com/feed.xml'), 'https://example.com/');
  assert.equal(parseFeedSiteUrl('<feed/>', 'javascript:alert(1)'), '');
});

test('reads the writer a feed item credits', () => {
  assert.equal(parseFeedItemAuthor('<item><dc:creator><![CDATA[Jane Doe]]></dc:creator></item>'), 'Jane Doe');
  assert.equal(parseFeedItemAuthor('<entry><author><name>Ada Lovelace</name><uri>https://example.com</uri></author></entry>'), 'Ada Lovelace');
  assert.equal(parseFeedItemAuthor('<item><author>jane@example.com (Jane Doe)</author></item>'), 'Jane Doe');
  assert.equal(
    parseFeedItemAuthor('<item><dc:creator>Jane Doe</dc:creator><dc:creator>Sam Lee</dc:creator></item>'),
    'Jane Doe and Sam Lee'
  );
});

test('leaves the writer unset when the feed names no one usable', () => {
  assert.equal(parseFeedItemAuthor('<item><dc:creator>Ars Technica</dc:creator></item>', 'Ars Technica'), '');
  assert.equal(parseFeedItemAuthor('<item><dc:creator>admin</dc:creator></item>'), '');
  assert.equal(parseFeedItemAuthor('<item><author>jane@example.com</author></item>'), '');
  assert.equal(parseFeedItemAuthor('<item><title>No byline here</title></item>'), '');
});

test('reads the writer an article page credits', () => {
  assert.equal(
    parseArticleAuthor('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"NewsArticle","author":{"@type":"Person","name":"Jon Brodkin"}}]}</script>'),
    'Jon Brodkin'
  );
  assert.equal(
    parseArticleAuthor('<html><head><meta name="author" content="Shalma Wegsman"></head></html>'),
    'Shalma Wegsman'
  );
  assert.equal(
    parseArticleAuthor('<p>By <a rel="author" href="/staff/tyler">Tyler Cowen</a></p>'),
    'Tyler Cowen'
  );
});

test('keeps the writer rather than the publication when a page names both', () => {
  assert.equal(
    parseArticleAuthor('<script type="application/ld+json">[{"@type":"NewsArticle","author":[{"@type":"Organization","name":"Ars Technica"},{"@type":"Person","name":"Dan Goodin"}]}]</script>', 'Ars Technica'),
    'Dan Goodin'
  );
  assert.equal(
    parseArticleAuthor('<script type="application/ld+json">[{"@type":"Organization","name":"Ars Technica"}]</script>', 'Ars Technica'),
    ''
  );
});

test('ignores a profile address and names nobody when a page has no byline', () => {
  assert.equal(
    parseArticleAuthor('<meta property="article:author" content="https://example.com/people/jane">'),
    ''
  );
  assert.equal(parseArticleAuthor('<html><head><title>No byline</title></head></html>'), '');
});

test('reads and cleans standard site description metadata', () => {
  const html = '<html><head><meta property="og:description" content="Open&amp;nbsp;access publishing"><meta name="description" content="Independent news about cities, culture, and public life."></head></html>';
  assert.equal(parseSitePageDescription(html), 'Independent news about cities, culture, and public life.');
  assert.equal(parseSitePageDescription('<html><head><title>Only a title</title></head></html>'), '');
});
