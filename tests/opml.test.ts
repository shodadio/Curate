import test from 'node:test';
import assert from 'node:assert/strict';

import { parseOpmlText } from '../lib/opml.ts';

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Curator subscriptions</title></head>
  <body>
${body}
  </body>
</opml>`;

test('parses nested folder outlines into per-feed folders', () => {
  const { sources, failures, foundAnyOutline } = parseOpmlText(wrap(`
    <outline text="Subscriptions">
      <outline text="Economics">
        <outline type="rss" text="Marginal Revolution" xmlUrl="https://marginalrevolution.com/feed"/>
        <outline type="rss" text="Stratechery" xmlUrl="https://stratechery.com/feed"/>
      </outline>
      <outline text="Design">
        <outline type="rss" text="Kottke" xmlUrl="https://kottke.org/index.xml"/>
      </outline>
    </outline>`));
  assert.equal(foundAnyOutline, true);
  assert.equal(failures.length, 0);
  assert.deepEqual(sources.map(source => source.title), ['Marginal Revolution', 'Stratechery', 'Kottke']);
  assert.deepEqual(sources.map(source => source.folder), ['Economics', 'Economics', 'Design']);
  assert.deepEqual(sources.map(source => source.feedUrl), [
    'https://marginalrevolution.com/feed',
    'https://stratechery.com/feed',
    'https://kottke.org/index.xml',
  ]);
  assert.ok(sources.every(source => source.status === 'active'));
  assert.ok(sources.every(source => /^src_[a-z0-9]+$/.test(source.id)), 'ids keep the src_ prefix');
  assert.equal(new Set(sources.map(source => source.id)).size, sources.length, 'ids are unique');
});

test('the Subscriptions wrapper is not mistaken for a folder', () => {
  const { sources } = parseOpmlText(wrap(`
    <outline text="Subscriptions">
      <outline type="rss" text="Loose feed" xmlUrl="https://loose.example/feed"/>
    </outline>`));
  assert.equal(sources[0].folder, 'Uncategorized');
});

test('feeds without a wrapper folder or category land in Uncategorized', () => {
  const { sources } = parseOpmlText(wrap(`<outline type="rss" text="Bare" xmlUrl="https://bare.example/feed"/>`));
  assert.equal(sources[0].folder, 'Uncategorized');
  assert.deepEqual(sources[0].categories, ['Uncategorized']);
});

test('a category attribute is used when there is no folder outline', () => {
  const { sources } = parseOpmlText(wrap(
    `<outline type="rss" text="Categorised" xmlUrl="https://cat.example/feed" category="Technology"/>`,
  ));
  assert.equal(sources[0].folder, 'Technology');
  assert.deepEqual(sources[0].categories, ['Technology']);
});

test('falls back to the text attribute when title is missing', () => {
  const { sources } = parseOpmlText(wrap(`<outline type="rss" text="Only text" xmlUrl="https://text.example/feed"/>`));
  assert.equal(sources[0].title, 'Only text');
});

test('decodes XML entities in titles and feed URLs', () => {
  const { sources } = parseOpmlText(wrap(
    `<outline type="rss" text="Tom &amp; Jerry&#39;s &#x27;show&#x27;" xmlUrl="https://example.com/feed?x=1&amp;y=2"/>`,
  ));
  assert.equal(sources[0].title, "Tom & Jerry's 'show'");
  assert.equal(sources[0].feedUrl, 'https://example.com/feed?x=1&y=2');
});

test('a ">" inside a quoted attribute does not end the tag', () => {
  const { sources } = parseOpmlText(wrap(`<outline type="rss" text="A > B" xmlUrl="https://arrow.example/feed"/>`));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'A > B');
});

test('single-quoted attributes are supported', () => {
  const { sources } = parseOpmlText(wrap(`<outline type='rss' text='Quoted' xmlUrl='https://quote.example/feed'/>`));
  assert.equal(sources[0].title, 'Quoted');
  assert.equal(sources[0].feedUrl, 'https://quote.example/feed');
});

test('comments and CDATA are skipped, so commented-out feeds are not imported', () => {
  const { sources } = parseOpmlText(wrap(`
    <!-- <outline type="rss" text="Commented" xmlUrl="https://commented.example/feed"/> -->
    <![CDATA[ <outline type="rss" text="Cdata" xmlUrl="https://cdata.example/feed"/> ]]>
    <outline type="rss" text="Real" xmlUrl="https://real.example/feed"/>`));
  assert.deepEqual(sources.map(source => source.title), ['Real']);
});

test('duplicate feed URLs are dropped silently, case-insensitively', () => {
  const { sources, failures } = parseOpmlText(wrap(`
    <outline type="rss" text="First" xmlUrl="https://dup.example/feed"/>
    <outline type="rss" text="Second" xmlUrl="https://DUP.example/feed"/>`));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'First');
  assert.equal(failures.length, 0, 'a duplicate is not reported as a failure');
});

test('an unparsable feed URL is kept as a failing source and reported', () => {
  const { sources, failures } = parseOpmlText(wrap(`<outline type="rss" text="Broken" xmlUrl="not a url"/>`));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].status, 'failing');
  assert.equal(sources[0].failingReason, 'Invalid feed URL format');
  assert.deepEqual(failures, [{ title: 'Broken', reason: 'Invalid feed URL format' }]);
});

test('non-http feed URLs are treated as invalid', () => {
  const { sources } = parseOpmlText(wrap(`<outline type="rss" text="FTP" xmlUrl="ftp://example.com/feed"/>`));
  assert.equal(sources[0].status, 'failing');
});

test('a self-closing RSS outline with no xmlUrl is reported as a failure', () => {
  const { sources, failures, foundAnyOutline } = parseOpmlText(wrap(`<outline type="rss" text="No url"/>`));
  assert.equal(foundAnyOutline, true);
  assert.equal(sources.length, 0);
  assert.deepEqual(failures, [{ title: 'No url', reason: 'Missing xmlUrl attribute' }]);
});

test('an empty xmlUrl attribute is reported as a missing feed URL', () => {
  const { sources, failures } = parseOpmlText(wrap(`
    <outline text="Empty">
      <outline type="rss" text="Empty url" xmlUrl=""/>
    </outline>`));
  assert.equal(sources.length, 0);
  assert.deepEqual(failures, [{ title: 'Empty url', reason: 'Missing feed URL' }]);
});

test('Curator category metadata overrides the folder and is normalised', () => {
  const { sources } = parseOpmlText(wrap(
    `<outline type="rss" text="Tagged" xmlUrl="https://tagged.example/feed" curatorCategories="[&quot;Tech&quot;,&quot;tech&quot;,&quot;  AI  &quot;]"/>`,
  ));
  assert.deepEqual(sources[0].categories, ['Tech', 'AI'], 'trimmed and de-duplicated case-insensitively');
  assert.equal(sources[0].folder, 'Uncategorized');
});

test('invalid Curator category metadata falls back to the ordinary folder', () => {
  const { sources } = parseOpmlText(wrap(`
    <outline text="Design">
      <outline type="rss" text="Tagged" xmlUrl="https://bad.example/feed" curatorCategories="[not json"/>
    </outline>`));
  assert.deepEqual(sources[0].categories, ['Design']);
});

test('namespaced outline tags are understood', () => {
  const { sources } = parseOpmlText(wrap(`<opml:outline type="rss" text="Namespaced" xmlUrl="https://ns.example/feed" />`));
  assert.equal(sources[0].title, 'Namespaced');
});

test('a document with no outlines reports foundAnyOutline false', () => {
  const { sources, failures, foundAnyOutline } = parseOpmlText(wrap('    <p>Nothing here</p>'));
  assert.equal(foundAnyOutline, false);
  assert.equal(sources.length, 0);
  assert.equal(failures.length, 0);
});

test('nested folders restore the parent folder after a child closes', () => {
  const { sources } = parseOpmlText(wrap(`
    <outline text="Parent">
      <outline text="Child">
        <outline type="rss" text="In child" xmlUrl="https://child.example/feed"/>
      </outline>
      <outline type="rss" text="In parent" xmlUrl="https://parent.example/feed"/>
    </outline>`));
  assert.deepEqual(sources.map(source => source.folder), ['Child', 'Parent']);
});

test('parses a flat subscription list exported by other readers', () => {
  const { sources } = parseOpmlText(wrap(`
    <outline type="rss" text="Feedly style" title="Feedly style" xmlUrl="https://a.example/feed" htmlUrl="https://a.example"/>
    <outline type="rss" text="Second" title="Second" xmlUrl="https://b.example/feed" htmlUrl="https://b.example"/>`));
  assert.equal(sources.length, 2);
  assert.ok(sources.every(source => source.status === 'active'));
});
