import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APIFY_SEARCH_ACTOR,
  apifyCandidatesFromDataset,
  apifySearchInput,
  apifySearchUrl,
} from '../lib/apifySearch.ts';

test('the search input carries the trimmed query and one page of results', () => {
  assert.deepEqual(apifySearchInput('  Byzantine history '), {
    queries: 'Byzantine history',
    maxPagesPerQuery: 1,
  });
});

test('the search URL names the actor and keeps the token out of the path', () => {
  const url = apifySearchUrl(' a b/c ');
  assert.match(url, new RegExp(`/acts/${APIFY_SEARCH_ACTOR}/run-sync-get-dataset-items`));
  assert.match(url, /[?&]token=a%20b%2Fc$/);
});

test('a database record is turned into one candidate per publication', () => {
  const candidates = apifyCandidatesFromDataset([
    {
      searchQuery: 'byzantine history',
      organicResults: [
        { title: 'Byzantine Matters', url: 'https://byzantinematters.org/2024/03/aegean', description: 'Essays on Byzantine history.' },
        { title: 'Byzantine Matters again', url: 'https://byzantinematters.org/another-post', description: 'The same publication.' },
        { title: 'The Levant Review', url: 'https://levantreview.com/', description: '' },
      ],
    },
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0], {
    title: 'Byzantine Matters',
    siteUrl: 'https://byzantinematters.org',
    summary: 'Essays on Byzantine history.',
  });
  // An empty description is left out rather than stored as a blank sentence.
  assert.equal(candidates[1].summary, undefined);
});

test('profiles, threads and reference pages are never offered as publications', () => {
  const candidates = apifyCandidatesFromDataset([
    {
      organicResults: [
        { title: 'r/byzantium', url: 'https://www.reddit.com/r/byzantium' },
        { title: 'Byzantine Empire', url: 'https://en.wikipedia.org/wiki/Byzantine_Empire' },
        { title: 'A thread', url: 'https://twitter.com/someone/status/1' },
        { title: 'A real one', url: 'https://byzantine.studio/post' },
      ],
    },
  ]);

  assert.deepEqual(candidates.map(candidate => candidate.siteUrl), ['https://byzantine.studio']);
});

test('a result without a usable address is skipped, not guessed at', () => {
  const candidates = apifyCandidatesFromDataset([
    {
      organicResults: [
        { title: 'No address' },
        { url: 'not a url' },
        { title: 'Wrong scheme', url: 'ftp://example.com/feed' },
        null,
      ],
    },
  ]);

  assert.deepEqual(candidates, []);
});

test('a result with no title falls back to its host', () => {
  const candidates = apifyCandidatesFromDataset([{ organicResults: [{ url: 'https://www.notitle.example/thing' }] }]);
  assert.equal(candidates[0].title, 'notitle.example');
});

test('a flat dataset of results is read the same way', () => {
  const candidates = apifyCandidatesFromDataset([
    { url: 'https://flat.example/post', title: 'Flat', snippet: 'A writer on things.' },
  ]);

  assert.deepEqual(candidates, [
    { title: 'Flat', siteUrl: 'https://flat.example', summary: 'A writer on things.' },
  ]);
});

test('anything that is not a dataset answers with nothing', () => {
  assert.deepEqual(apifyCandidatesFromDataset({ items: [] }), []);
  assert.deepEqual(apifyCandidatesFromDataset(null), []);
});

test('the candidate list stops at the limit the screen shows', () => {
  const organicResults = Array.from({ length: 9 }, (_, index) => ({
    title: `Publication ${index}`,
    url: `https://publication${index}.example/post`,
  }));

  assert.equal(apifyCandidatesFromDataset([{ organicResults }], 6).length, 6);
});
