// Runs once before the app reads anything, so no screen ever sees an id from the old scheme —
// including after a backup restore, which writes the file's values and then reloads.
import { migrateStoredMarkdown } from '../lib/markdownMigration';
import { migrateStoryIds } from '../lib/storyIdMigration';
import { readAppData, safeSetItem } from './storage';

export function migrateStoredStoryIds(): void {
  const stored = readAppData();
  const ids = migrateStoryIds(stored);
  const { data, changed } = migrateStoredMarkdown(ids.data);
  if (!changed) return;
  for (const [key, value] of Object.entries(data)) {
    if (stored[key] !== value) safeSetItem(key, value);
  }
}
