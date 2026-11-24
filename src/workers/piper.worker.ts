// Piper runs here rather than on the page: a sentence costs a few hundred milliseconds of
// solid CPU, and doing that on the main thread stalls scrolling and taps mid-article.
import * as tts from '@diffusionstudio/vits-web';

interface PiperRequest {
  id: number;
  type: 'stored' | 'download' | 'remove' | 'synth';
  voiceId?: string;
  text?: string;
}

const context = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<PiperRequest>) => void) => void;
  postMessage: (message: unknown) => void;
};

const reply = (message: Record<string, unknown>) => context.postMessage(message);

context.addEventListener('message', async event => {
  const request = event.data;
  if (!request || typeof request.id !== 'number') return;
  const voiceId = request.voiceId || '';

  try {
    if (request.type === 'stored') {
      reply({ id: request.id, type: 'stored', voices: await tts.stored() });
      return;
    }

    if (request.type === 'remove') {
      await tts.remove(voiceId as tts.VoiceId);
      reply({ id: request.id, type: 'done' });
      return;
    }

    if (request.type === 'download') {
      await tts.download(voiceId as tts.VoiceId, progress => {
        reply({ id: request.id, type: 'progress', loaded: progress.loaded, total: progress.total });
      });
      reply({ id: request.id, type: 'done' });
      return;
    }

    if (request.type === 'synth') {
      const blob = await tts.predict({ text: request.text || '', voiceId: voiceId as tts.VoiceId });
      reply({ id: request.id, type: 'audio', blob });
      return;
    }
  } catch (error: any) {
    reply({ id: request.id, type: 'error', message: error?.message || 'The downloaded voice failed.' });
  }
});
