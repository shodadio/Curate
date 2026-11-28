import { useCallback, useEffect, useRef, useState } from 'react';
import { readAppData, subscribeToAppDataChanges } from './storage';
import {
  backupPermission,
  canAutoBackup,
  chooseBackupFile,
  forgetBackupHandle,
  loadBackupHandle,
  rememberBackupHandle,
  writeBackupFile,
  type AutoBackupHandle,
} from './autoBackup';

// Settings change in bursts (a theme, then a size, then a face); the file follows once the
// reader has stopped, not once per keystroke.
const WRITE_DELAY_MS = 2000;

export interface AutoBackupView {
  supported: boolean;
  fileName: string | null;
  needsPermission: boolean;
  lastSavedAt: number | null;
  saving: boolean;
  error: string | null;
}

export interface AutoBackupControls {
  state: AutoBackupView;
  chooseFile: () => Promise<void>;
  reconnect: () => Promise<void>;
  saveNow: () => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Keeps one file on the reader's disk in step with what the browser stores. The file is the
 * durable copy: it survives clearing site data, and Restore from a backup reads it back.
 */
export function useAutoBackup(): AutoBackupControls {
  const [state, setState] = useState<AutoBackupView>(() => ({
    supported: canAutoBackup(),
    fileName: null,
    needsPermission: false,
    lastSavedAt: null,
    saving: false,
    error: null,
  }));

  const handleRef = useRef<AutoBackupHandle | null>(null);
  const needsPermissionRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  // One write at a time: two overlapping streams to the same file can truncate it.
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const patch = useCallback((next: Partial<AutoBackupView>) => {
    setState(current => ({ ...current, ...next }));
  }, []);

  const write = useCallback((handle: AutoBackupHandle): Promise<void> => {
    const task = async () => {
      patch({ saving: true, error: null });
      const result = await writeBackupFile(handle, readAppData());
      patch(result.ok
        ? { saving: false, error: null, lastSavedAt: result.savedAt }
        : { saving: false, error: result.error });
    };
    writeQueueRef.current = writeQueueRef.current.then(task, task);
    return writeQueueRef.current;
  }, [patch]);

  // A file chosen in an earlier session is still remembered; ask whether this session may
  // write to it, and only write without a prompt when the browser already said yes.
  useEffect(() => {
    if (!canAutoBackup()) return;
    let cancelled = false;
    (async () => {
      const handle = await loadBackupHandle();
      if (!handle || cancelled) return;
      handleRef.current = handle;
      const permission = await backupPermission(handle);
      if (cancelled) return;
      needsPermissionRef.current = permission !== 'granted';
      patch({ fileName: handle.name, needsPermission: permission !== 'granted' });
      if (permission === 'granted') await write(handle);
    })();
    return () => { cancelled = true; };
  }, [patch, write]);

  useEffect(() => {
    const flush = () => {
      const handle = handleRef.current;
      if (!handle || needsPermissionRef.current) return;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      void write(handle);
    };
    const schedule = () => {
      if (!handleRef.current || needsPermissionRef.current) return;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, WRITE_DELAY_MS);
    };

    const unsubscribe = subscribeToAppDataChanges(schedule);
    // Hiding the tab is the last chance to carry the newest settings into the file, and it is
    // reported before the page goes away; a write started while the page unloads cannot finish.
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onHidden);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [write]);

  const chooseFile = useCallback(async () => {
    patch({ error: null });
    let handle: AutoBackupHandle | null;
    try {
      // The picker grants write access to the file it returns, so this needs no permission ask.
      handle = await chooseBackupFile();
    } catch {
      patch({ error: 'This browser did not open a file picker, so no backup file was chosen.' });
      return;
    }
    if (!handle) return;
    handleRef.current = handle;
    needsPermissionRef.current = false;
    patch({ fileName: handle.name, needsPermission: false, lastSavedAt: null, error: null });
    await rememberBackupHandle(handle);
    await write(handle);
  }, [patch, write]);

  const reconnect = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    patch({ error: null });
    const permission = await backupPermission(handle, true);
    needsPermissionRef.current = permission !== 'granted';
    if (permission !== 'granted') {
      patch({
        needsPermission: true,
        error: 'This browser did not grant access to the backup file. Choose the file again to keep backing up.',
      });
      return;
    }
    patch({ needsPermission: false });
    await write(handle);
  }, [patch, write]);

  const saveNow = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) await write(handle);
  }, [write]);

  const stop = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    handleRef.current = null;
    needsPermissionRef.current = false;
    await forgetBackupHandle();
    patch({ fileName: null, needsPermission: false, lastSavedAt: null, saving: false, error: null });
  }, [patch]);

  return { state, chooseFile, reconnect, saveNow, stop };
}
