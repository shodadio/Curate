// The page's side of the Piper worker. One worker for the whole session keeps the model and
// its session warm between sentences, which is the difference between a gap and a pause.

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

// A downloaded voice needs a worker and this origin's private file system. Browsers without
// either keep the device voice rather than offering a download that cannot be kept.
export function piperSupported(): boolean {
  return typeof Worker !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof (navigator as any).storage?.getDirectory === 'function';
}

function getWorker(): Worker {
  if (worker) return worker;

  const started = new Worker(new URL('../workers/piper.worker.ts', import.meta.url), { type: 'module' });

  started.addEventListener('message', (event: MessageEvent<any>) => {
    const data = event.data || {};
    const entry = pending.get(data.id);
    if (!entry) return;

    if (data.type === 'progress') {
      const total = Number(data.total) || 0;
      entry.onProgress?.(total > 0 ? Math.min(1, Number(data.loaded) / total) : 0);
      return;
    }

    pending.delete(data.id);
    if (data.type === 'error') {
      entry.reject(new Error(data.message || 'The downloaded voice failed.'));
      return;
    }
    entry.resolve(data);
  });

  started.addEventListener('error', () => {
    // A worker that dies takes every queued sentence with it: fail them rather than hang.
    const waiting = [...pending.values()];
    pending.clear();
    started.terminate();
    worker = null;
    for (const entry of waiting) entry.reject(new Error('The downloaded voice stopped responding.'));
  });

  worker = started;
  return started;
}

function ask<T>(message: Record<string, unknown>, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextRequestId;
    nextRequestId += 1;
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...message, id });
  });
}

export async function storedPiperVoices(): Promise<string[]> {
  if (!piperSupported()) return [];
  const reply = await ask<{ voices?: string[] }>({ type: 'stored' });
  return reply.voices || [];
}

export async function downloadPiperVoice(voiceId: string, onProgress?: (fraction: number) => void): Promise<void> {
  await ask({ type: 'download', voiceId }, onProgress);
}

export async function removePiperVoice(voiceId: string): Promise<void> {
  await ask({ type: 'remove', voiceId });
}

export async function synthesizePiper(voiceId: string, text: string): Promise<Blob> {
  const reply = await ask<{ blob?: Blob }>({ type: 'synth', voiceId, text });
  if (!reply.blob) throw new Error('The downloaded voice returned no audio.');
  return reply.blob;
}
