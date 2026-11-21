import test from 'node:test';
import assert from 'node:assert/strict';

import { findVideoEmbed, readVideoEmbed, videoEmbedFromUrl, videoWatchUrl } from '../lib/videoEmbed.ts';

test('a YouTube watch, short or embed link becomes one no-tracking embed address', () => {
  const expected = { url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', kind: 'embed' };
  assert.deepEqual(videoEmbedFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), expected);
  assert.deepEqual(videoEmbedFromUrl('https://youtu.be/dQw4w9WgXcQ?si=abc'), expected);
  assert.deepEqual(videoEmbedFromUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1'), expected);
  assert.deepEqual(videoEmbedFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), expected);
  assert.deepEqual(videoEmbedFromUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), expected);
});

test('a channel, a playlist or a search is not a playable video', () => {
  assert.equal(videoEmbedFromUrl('https://www.youtube.com/@veritasium'), null);
  assert.equal(videoEmbedFromUrl('https://www.youtube.com/playlist?list=PL123456'), null);
  assert.equal(videoEmbedFromUrl('https://www.youtube.com/results?search_query=video'), null);
  // A video id is eleven characters; anything else is not one.
  assert.equal(videoEmbedFromUrl('https://www.youtube.com/watch?v=tooshort'), null);
});

test('Vimeo keeps an unlisted video playable and turns tracking off', () => {
  assert.deepEqual(videoEmbedFromUrl('https://vimeo.com/76979871'), {
    url: 'https://player.vimeo.com/video/76979871?dnt=1',
    kind: 'embed',
  });
  assert.deepEqual(videoEmbedFromUrl('https://player.vimeo.com/video/76979871?h=1a2b3c4d5e'), {
    url: 'https://player.vimeo.com/video/76979871?dnt=1&h=1a2b3c4d5e',
    kind: 'embed',
  });
  // A hash that is not one is not passed on, so a stray parameter cannot travel into the frame.
  assert.equal(
    videoEmbedFromUrl('https://vimeo.com/76979871?h=not-a-hash')?.url,
    'https://player.vimeo.com/video/76979871?dnt=1',
  );
  assert.equal(videoEmbedFromUrl('https://vimeo.com/staffpicks'), null);
});

test('a video file is played by the page itself, and anything unplayable is refused', () => {
  assert.deepEqual(videoEmbedFromUrl('https://cdn.example.com/clip.mp4?token=abc'), {
    url: 'https://cdn.example.com/clip.mp4?token=abc',
    kind: 'file',
  });
  assert.deepEqual(videoEmbedFromUrl('https://cdn.example.com/stream/master.m3u8'), {
    url: 'https://cdn.example.com/stream/master.m3u8',
    kind: 'file',
  });
  assert.equal(videoEmbedFromUrl('https://example.com/article'), null);
  // A plain-http video would be blocked as mixed content, and a script is never a video.
  assert.equal(videoEmbedFromUrl('http://cdn.example.com/clip.mp4'), null);
  assert.equal(videoEmbedFromUrl('javascript:alert(1)'), null);
  assert.equal(videoEmbedFromUrl('data:video/mp4;base64,AAAA'), null);
});

test('a player in the body is found, and an ordinary frame is left alone', () => {
  const embedded = findVideoEmbed(
    '<p>Before</p><iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><p>After</p>',
    'https://example.com/story',
  );
  assert.deepEqual(embedded, { url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', kind: 'embed' });

  // A newsletter widget, a map and an advert are pages, not videos: framing them is not our call.
  assert.equal(findVideoEmbed('<iframe src="https://example.com/embed/widget"></iframe>'), null);
  assert.equal(findVideoEmbed('<iframe src="https://www.google.com/maps/embed?pb=x"></iframe>'), null);
  assert.equal(findVideoEmbed('<iframe src="about:blank"></iframe>'), null);
});

test('a lazily loaded player is read from the address it will load', () => {
  const video = findVideoEmbed(
    '<iframe src="about:blank" data-src="https://player.vimeo.com/video/76979871"></iframe>',
    'https://example.com/story',
  );
  assert.deepEqual(video, { url: 'https://player.vimeo.com/video/76979871?dnt=1', kind: 'embed' });
});

test('a <video> element gives its file and the still that belongs with it', () => {
  const video = findVideoEmbed(
    '<video poster="https://cdn.example.com/clip.jpg" controls><source src="/media/clip.mp4" type="video/mp4"></video>',
    'https://example.com/story',
  );
  assert.deepEqual(video, {
    url: 'https://example.com/media/clip.mp4',
    kind: 'file',
    poster: 'https://cdn.example.com/clip.jpg',
  });

  // Ars article clips use WordPress's wrapper and put the playable address on a <source> child.
  // The reader fetches the article page and passes this original markup into the same finder.
  assert.deepEqual(findVideoEmbed(
    '<figure><div class="wp-video"><video id="video-2096324-1" class="wp-video-shortcode" controls><source src="https://cdn.arstechnica.net/wp-content/uploads/2025/05/clip.mp4?_=1" type="video/mp4"></video></div><figcaption>Video caption</figcaption></figure>',
    'https://arstechnica.com/story/',
  ), {
    url: 'https://cdn.arstechnica.net/wp-content/uploads/2025/05/clip.mp4?_=1',
    kind: 'file',
  });

  // The file on the element itself, with no poster, is still a video.
  assert.deepEqual(findVideoEmbed('<video src="https://cdn.example.com/clip.webm"></video>'), {
    url: 'https://cdn.example.com/clip.webm',
    kind: 'file',
  });
});

test('a player the feed escaped is still a player, with its address intact', () => {
  const escaped = '&lt;figure&gt;&lt;iframe src=&quot;https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&quot;&gt;&lt;/iframe&gt;&lt;/figure&gt;';
  assert.deepEqual(findVideoEmbed(escaped, 'https://example.com/story'), {
    url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    kind: 'embed',
  });
  // A player's own query string is decoded too, so its second parameter travels with it.
  const file = findVideoEmbed('<video src="https://cdn.example.com/clip.mp4?a=1&amp;b=2"></video>');
  assert.deepEqual(file, { url: 'https://cdn.example.com/clip.mp4?a=1&b=2', kind: 'file' });
});

test('a player that cannot be embedded still has somewhere to send the reader', () => {
  assert.equal(
    videoWatchUrl({ url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', kind: 'embed' }),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  );
  assert.equal(
    videoWatchUrl({ url: 'https://player.vimeo.com/video/76979871?dnt=1', kind: 'embed' }),
    'https://vimeo.com/76979871',
  );
  // A file is its own page: the browser plays it, or offers to download it.
  assert.equal(
    videoWatchUrl({ url: 'https://cdn.example.com/clip.mp4', kind: 'file' }),
    'https://cdn.example.com/clip.mp4',
  );
});

test('a stored video is trusted only when it is one this app can play', () => {
  assert.deepEqual(readVideoEmbed({ url: 'https://cdn.example.com/clip.mp4', kind: 'file' }), {
    url: 'https://cdn.example.com/clip.mp4',
    kind: 'file',
  });
  assert.deepEqual(
    readVideoEmbed({ url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', kind: 'embed', poster: 'https://cdn.example.com/p.jpg' }),
    { url: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', kind: 'embed', poster: 'https://cdn.example.com/p.jpg' },
  );
  // A damaged save, an unknown kind, or a frame pointing anywhere else is no video at all.
  assert.equal(readVideoEmbed(null), null);
  assert.equal(readVideoEmbed('https://youtu.be/x'), null);
  assert.equal(readVideoEmbed({ url: 'https://example.com/player', kind: 'embed' }), null);
  assert.equal(readVideoEmbed({ url: 'https://cdn.example.com/clip.mp4', kind: 'stream' }), null);
  assert.equal(readVideoEmbed({ url: 'http://cdn.example.com/clip.mp4', kind: 'file' }), null);
  // A poster that is not https is dropped; the video itself still plays.
  assert.deepEqual(readVideoEmbed({ url: 'https://cdn.example.com/clip.mp4', kind: 'file', poster: 'http://x/y.jpg' }), {
    url: 'https://cdn.example.com/clip.mp4',
    kind: 'file',
  });
});
