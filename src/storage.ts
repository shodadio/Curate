// localStorage is the only copy of a tester's library, and it can refuse a write:
// Safari throws QuotaExceededError once the origin is full, private windows and
// locked-down profiles throw SecurityError, and an embedded webview can throw for
// reasons of its own. A throw inside a commit-phase effect unmounts the tree, so every
// write in the app goes through here instead of calling setItem directly.

export type StorageFailure = 'quota' | 'blocked';

const APP_KEY_PREFIX = 'curator_';

// Values that could not be written are kept for this session only, so the reader can
// carry on reading and re-saving even when the browser refuses to persist anything.
const memoryFallback = new Map<string, string>();
const listeners = new Set<(failure: StorageFailure) => void>();

// Keep the last failure so a listener that subscribes after the write still hears about it
// (the first writes happen during mount, before the banner's effect has run).
let lastFailure: StorageFailure | null = null;

const classify = (error: unknown): StorageFailure => {
  const name = (error as { name?: string } | null)?.name || '';
  const code = (error as { code?: number } | null)?.code;
  return name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
    ? 'quota'
    : 'blocked';
};

export function subscribeToStorageFailures(listener: (failure: StorageFailure) => void): () => void {
  listeners.add(listener);
  if (lastFailure) {
    try { listener(lastFailure); } catch { /* ignore */ }
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Writes one key. Returns false when the browser refused to persist it. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    memoryFallback.delete(key);
    return true;
  } catch (error) {
    memoryFallback.set(key, value);
    lastFailure = classify(error);
    listeners.forEach(listener => {
      // A listener must never be the reason a write appears to fail harder.
      try { listener(lastFailure as StorageFailure); } catch { /* ignore */ }
    });
    return false;
  }
}

/**
 * Reads one key. Returns null when the browser refuses to hand storage over at all, and
 * prefers a value this session could not persist over the stale one still on disk.
 */
export function safeGetItem(key: string): string | null {
  if (memoryFallback.has(key)) return memoryFallback.get(key) as string;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Serialises and writes one key; unserialisable values are dropped, not thrown. */
export function safeSetJson(key: string, value: unknown): boolean {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  return safeSetItem(key, serialized);
}

/** Every curator_* value, for the error screen's "Export my data". */
export function readAppData(): Record<string, string> {
  const data: Record<string, string> = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(APP_KEY_PREFIX)) continue;
      data[key] = localStorage.getItem(key) ?? '';
    }
  } catch {
    // Storage unreadable: fall through to whatever this session managed to keep.
  }
  memoryFallback.forEach((value, key) => {
    if (key.startsWith(APP_KEY_PREFIX)) data[key] = value;
  });
  return data;
}

/** Downloads everything Curator has stored, so a broken page doesn't mean a lost library. */
export function downloadAppData(): boolean {
  try {
    const payload = {
      app: 'curator',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: readAppData(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `curator-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** Removes every value owned by Curator from this browser, without touching other apps. */
export function clearAppData(): boolean {
  let cleared = true;
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(APP_KEY_PREFIX)) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
  } catch {
    cleared = false;
  }

  for (const key of memoryFallback.keys()) {
    if (key.startsWith(APP_KEY_PREFIX)) memoryFallback.delete(key);
  }
  if (cleared) lastFailure = null;
  return cleared;
}
