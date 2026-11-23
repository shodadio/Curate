// Read-aloud preparation: what the voice is given, which is not the same as what the page
// shows. Everything here is about not reading scraped machinery out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSpeechQueue } from '../src/App.tsx';
import { normaliseForSpeech } from '../lib/speech.ts';

const article = (fullText: string) => ({
  id: 'speech-test',
  title: 'Test article',
  source: 'Test Source',
  folder: 'General',
  readTime: '3 min read',
  why: 'Selected for this test.',
  summary: '',
  url: 'https://example.com/original',
  fullText,
  isOutOfBubble: false,
});

test('read-aloud drops an address rather than spelling it out', () => {
  assert.equal(
    normaliseForSpeech('The demo lives at https://example.com/demo?id=1, and it explains the approach.'),
    'The demo lives at a link, and it explains the approach.',
  );
});

test('read-aloud drops the query debris a stripped address leaves behind', () => {
  assert.equal(
    normaliseForSpeech('https://lite.datasette.io/?install=datasette-maplibre & url=https://.../demo.db & metadata=https://.../metadata.yml'),
    '',
  );
});

test('read-aloud keeps the sentence a link was standing in', () => {
  assert.equal(
    normaliseForSpeech('Demo of the bug: https://lite.datasette.io/?ref=1.0a42& sql=https://gist.github.com/simonw/75ececf6#/data/scores?_size=2&_sort=score - click next and the second page is empty.'),
    'Demo of the bug, click next and the second page is empty.',
  );
});

test('read-aloud leaves out quotation marks and bracketed notes', () => {
  assert.equal(
    normaliseForSpeech('“The difference lies less in the technology itself and more in the user,” said Jackson G. Lu.'),
    'The difference lies less in the technology itself and more in the user, said Jackson G. Lu.',
  );
  assert.equal(
    normaliseForSpeech("ok it's official...[ellipses from original quote] AI-written code is now the norm."),
    "ok it's official. AI-written code is now the norm.",
  );
});

test('read-aloud leaves ordinary prose, numbers and slashes alone', () => {
  const spoken = normaliseForSpeech('At the #AI summit the U.S. share rose 1.79% and/or fell, on the 4.2/180 curve.');
  assert.match(spoken, /#AI/);
  assert.match(spoken, /U\.S\./);
  assert.match(spoken, /1\.79/);
  assert.match(spoken, /and\/or/);
});

test('a paragraph that is only an address is not spoken at all', () => {
  const queue = buildSpeechQueue(article([
    'The demo lives at https://example.com/demo?id=1.',
    'https://lite.datasette.io/?install=datasette-maplibre & url=https://.../demo.db',
    'A real closing paragraph.',
  ].join('\n\n')));
  const spoken = queue.map(chunk => chunk.text);
  assert.equal(spoken.some(text => /https?:\/\/|url=|metadata=/.test(text)), false, JSON.stringify(spoken));
  assert.equal(spoken.includes('A real closing paragraph.'), true, JSON.stringify(spoken));
});

test('read-aloud reads Markdown emphasis as plain words, like the screen', () => {
  assert.equal(
    normaliseForSpeech('Essays on **growth**, plus `inline code`.'),
    'Essays on growth, plus inline code.',
  );
  const queue = buildSpeechQueue(article('Essays on **growth**.\n\nA *quiet* staying case.'));
  const spoken = queue.map(chunk => chunk.text);
  assert.equal(spoken.includes('Essays on growth.'), true, JSON.stringify(spoken));
  assert.equal(spoken.includes('A quiet staying case.'), true, JSON.stringify(spoken));
});
