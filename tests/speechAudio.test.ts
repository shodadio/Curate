import test from 'node:test';
import assert from 'node:assert/strict';
import { prefetchSpeechAudio, stopSpeechAudio, takePrefetchedSpeechAudio } from '../src/lib/speechAudio.ts';

test('prefetch retention keeps the next sentence when adding the next lookahead window', async () => {
  stopSpeechAudio();
  const clip = new Blob(['prefetched audio']);
  const render = async () => clip;

  // Sentence 5 is the next clip; while it plays, 6 and 7 are added to the lookahead window.
  prefetchSpeechAudio('sentence-5', render);
  prefetchSpeechAudio('sentence-6', render);
  prefetchSpeechAudio('sentence-7', render);

  const next = takePrefetchedSpeechAudio('sentence-5');
  assert.ok(next, 'adding future clips must not evict the sentence that should play next');
  assert.equal(await next, clip);
  stopSpeechAudio();
});
