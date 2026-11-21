// Runs once before the app reads anything, so no screen ever sees an id from the old scheme —
// including after a backup restore, which writes the file's values and then reloads.
import { migrateStoryIds } from '../lib/storyIdMigration';
import { readAppData, safeSetItem } from './storage';

export function migrateStoredStoryIds(): void {
  const stored = readAppData();
  const { data, changed } = migrateStoryIds(stored);
  if (!changed) return;
  for (const [key, value] of Object.entries(data)) {
    if (stored[key] !== value) safeSetItem(key, value);
  }
}
