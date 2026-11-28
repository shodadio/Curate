// Browser storage is cleared by "clear site data", a new profile, or an eviction when the
// origin is full — and it is the only copy of the library. A file the reader picks on their
// own disk is the one copy that outlives all of those, so this module keeps that file current.
//
// Writing it uses the File System Access API: the reader picks the file once, and the same
// file is rewritten in place afterwards. The handle is remembered in IndexedDB across
// reloads. Chromium asks for permission again at the start of a new session, which is why the
// caller offers "Reconnect" rather than writing silently.

import { backupFile } from '../lib/backup';

export interface AutoBackupWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/** The part of FileSystemFileHandle this module uses, so the code typechecks without lib.dom. */
export interface AutoBackupHandle {
  name: string;
  createWritable(): Promise<AutoBackupWritable>;
  queryPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<BackupPermission>;
  requestPermission?(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<BackupPermission>;
}

export type BackupPermission = 'granted' | 'prompt' | 'denied';

type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<AutoBackupHandle>;

const BACKUP_FILE_NAME = 'curator-backup.json';

const DB_NAME = 'curator_auto_backup';
const STORE_NAME = 'files';
const HANDLE_KEY = 'library';

/** File System Access is Chromium-only; Firefox and Safari fall back to Export a copy. */
export function canAutoBackup(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

/** Opens the save picker. Resolves null when the reader cancels it. */
export async function chooseBackupFile(): Promise<AutoBackupHandle | null> {
  if (typeof window === 'undefined') return null;
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker.call(window, {
      suggestedName: BACKUP_FILE_NAME,
      types: [{ description: 'Curator backup', accept: { 'application/json': ['.json'] } }],
    });
  } catch (error) {
    // Cancelling the picker is not a failure, so it is not reported as one.
    if ((error as { name?: string } | null)?.name === 'AbortError') return null;
    throw error;
  }
}

const openBackupDb = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('IndexedDB is unavailable'));
    return;
  }
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
});

const runOnStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openBackupDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = run(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
};

/** Remembers the chosen file for the next session; a browser that refuses keeps it in memory. */
export async function rememberBackupHandle(handle: AutoBackupHandle): Promise<void> {
  try {
    await runOnStore('readwrite', store => store.put(handle, HANDLE_KEY));
  } catch {
    /* the handle stays in memory for this session */
  }
}

export async function loadBackupHandle(): Promise<AutoBackupHandle | null> {
  try {
    const stored = await runOnStore<AutoBackupHandle | undefined>('readonly', store => store.get(HANDLE_KEY));
    return stored && typeof stored.name === 'string' ? stored : null;
  } catch {
    return null;
  }
}

/** Forgets the file without touching it on disk. */
export async function forgetBackupHandle(): Promise<void> {
  try {
    await runOnStore('readwrite', store => store.delete(HANDLE_KEY));
  } catch {
    /* the handle simply is not there to forget */
  }
}

/**
 * Whether this session may write to the file. `ask` must only be true inside a click handler:
 * browsers refuse a permission request that is not tied to a user gesture.
 */
export async function backupPermission(
  handle: AutoBackupHandle,
  ask = false,
): Promise<BackupPermission> {
  try {
    const descriptor = { mode: 'readwrite' as const };
    if (ask && handle.requestPermission) return await handle.requestPermission(descriptor);
    if (handle.queryPermission) return await handle.queryPermission(descriptor);
    // Older implementations have no permission methods and let the write decide.
    return 'granted';
  } catch {
    return 'prompt';
  }
}

export type BackupWrite =
  | { ok: true; savedAt: number; bytes: number }
  | { ok: false; error: string };

const explainWriteFailure = (error: unknown): string => {
  const name = (error as { name?: string } | null)?.name || '';
  if (name === 'NotAllowedError' || name === 'NoModificationAllowedError' || name === 'SecurityError') {
    return 'This browser no longer allows Curator to write that file. Reconnect it, or choose the file again.';
  }
  if (name === 'NotFoundError') {
    return 'That backup file has been moved or deleted. Choose it again to resume.';
  }
  if (name === 'QuotaExceededError') {
    return 'There is no room left on the disk for the backup file. Free some space, then try again.';
  }
  return 'Curator could not write the backup file. Check that its folder still exists, then try again.';
};

/**
 * Rewrites the chosen file with everything Curator stores. The format is the one Export a copy
 * writes, so either file can be brought back with Restore from a backup.
 */
export async function writeBackupFile(
  handle: AutoBackupHandle,
  data: Record<string, string>,
  now: Date = new Date(),
): Promise<BackupWrite> {
  const file = backupFile(data, now);
  if (Object.keys(file.data).length === 0) {
    // An empty library must never overwrite a good backup.
    return { ok: false, error: 'There is nothing stored yet to back up.' };
  }

  const text = JSON.stringify(file, null, 2);
  try {
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return { ok: true, savedAt: now.getTime(), bytes: new TextEncoder().encode(text).length };
  } catch (error) {
    return { ok: false, error: explainWriteFailure(error) };
  }
}
