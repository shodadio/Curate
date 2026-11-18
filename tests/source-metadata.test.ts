import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFeedChannelDescription, parseFeedSiteUrl, parseSitePageDescription } from '../lib/sourceMetadata.ts';

test('reads the channel description without mistaking an article description for it', () => {
  const feed = '<rss><channel><title>Example</title><description><![CDATA[<p>A journal about science and society.</p>]]></description><item><description>Article excerpt</description></item></channel></rss>';
  assert.equal(parseFeedChannelDescription(feed), 'A journal about science and society.');
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

test('reads and cleans standard site description metadata', () => {
  const html = '<html><head><meta property="og:description" content="Open&amp;nbsp;access publishing"><meta name="description" content="Independent news about cities, culture, and public life."></head></html>';
  assert.equal(parseSitePageDescription(html), 'Independent news about cities, culture, and public life.');
  assert.equal(parseSitePageDescription('<html><head><title>Only a title</title></head></html>'), '');
});
