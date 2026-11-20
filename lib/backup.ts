// The library in this browser is the only copy of it, so a copy that cannot be put back is not
// a backup. This module holds the file format, the validation that lets it back in, and the
// plan for replacing what is stored now with what the file carried.
//
// Validation is deliberately strict: a half-understood file is refused rather than merged, so a
// restore never silently drops the parts this build does not know how to read.

export const BACKUP_APP = 'curator';
export const BACKUP_VERSION = 1;
export const BACKUP_KEY_PREFIX = 'curator_';

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: string;
  data: Record<string, string>;
}

export type BackupRead =
  | { ok: true; data: Record<string, string>; exportedAt: number }
  | { ok: false; error: string };

// What a restore actually does: every stored key the file names is written, and every stored
// key the file does not name is removed, so the browser ends up holding exactly the backup.
export interface RestorePlan {
  write: Array<{ key: string; value: string }>;
  remove: string[];
}

export function backupFile(data: Record<string, string>, now: Date = new Date()): BackupFile {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data,
  };
}

export function readBackupFile(raw: string): BackupRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That file is not valid JSON, so it is not a Curator backup.' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'That file is not a Curator backup.' };
  }

  const record = value as Record<string, unknown>;
  if (record.app !== BACKUP_APP) {
    return { ok: false, error: 'That file was not written by Curator.' };
  }

  const version = typeof record.version === 'number' ? record.version : NaN;
  if (!Number.isFinite(version) || version < 1) {
    return { ok: false, error: 'That backup does not say which version of Curator wrote it.' };
  }
  if (version > BACKUP_VERSION) {
    return {
      ok: false,
      error: 'That backup was written by a newer version of Curator. Update the app, then restore it.',
    };
  }

  const data = record.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'That backup carries no library to restore.' };
  }

  const restored: Record<string, string> = {};
  for (const [key, entry] of Object.entries(data as Record<string, unknown>)) {
    // Anything outside Curator's own keys is not ours to write back.
    if (!key.startsWith(BACKUP_KEY_PREFIX)) continue;
    if (typeof entry !== 'string') {
      return { ok: false, error: `The backup's ${key} entry is damaged, so the file was not restored.` };
    }
    restored[key] = entry;
  }

  if (Object.keys(restored).length === 0) {
    return { ok: false, error: 'That backup holds no Curator library.' };
  }

  const exportedAt = typeof record.exportedAt === 'string' ? Date.parse(record.exportedAt) : NaN;
  return { ok: true, data: restored, exportedAt: Number.isFinite(exportedAt) ? exportedAt : 0 };
}

// Replacing rather than merging: a restored library has to look exactly like the one that was
// copied, or the reader keeps half of a profile they thought they had replaced.
export function restorePlan(
  current: Record<string, string>,
  backup: Record<string, string>,
): RestorePlan {
  const write = Object.entries(backup)
    .filter(([key]) => key.startsWith(BACKUP_KEY_PREFIX))
    .map(([key, value]) => ({ key, value }));
  const kept = new Set(write.map(entry => entry.key));
  const remove = Object.keys(current)
    .filter(key => key.startsWith(BACKUP_KEY_PREFIX) && !kept.has(key));
  return { write, remove };
}
