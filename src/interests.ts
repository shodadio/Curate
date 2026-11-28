// User-declared interests: the only part of the reading profile the reader states directly.
// Votes stay learned (semantic feedback); interests stay explicit, editable and reversible.

import { safeSetItem } from './storage';

export type InterestGroup = 'more' | 'less';

export interface InterestSet {
  more: string[];
  less: string[];
}

export const MAX_INTERESTS = 12;

// The starter vocabulary offered under "More of this": subjects a story can genuinely be about.
// Deliberately not editorial umbrellas ("Ideas", "Research") and not folder names, because a
// declared interest matching a category label lifts every story a feed files under it. Once
// clicked one of these is an ordinary interest: same weight, same matching, same way to remove.
export const COMMON_INTERESTS = [
  'AI',
  'Climate',
  'Science',
  'Health',
  'History',
  'Books',
  'Philosophy',
  'Design',
];

// One sentence for the three places folders, categories and interests meet, so the same three
// words are never explained three different ways.
export const TAXONOMY_NOTE = 'A folder files a source, categories say what it covers, and interests nudge what Curator picks — none of them hide stories from you.';

const STORAGE_KEY = 'curator_interests';

export const emptyInterests = (): InterestSet => ({ more: [], less: [] });

export const sanitizeLabel = (raw: unknown): string =>
  typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 40) : '';

const dedupeLabels = (labels: unknown): string[] => {
  if (!Array.isArray(labels)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of labels) {
    const label = sanitizeLabel(entry);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= MAX_INTERESTS) break;
  }
  return result;
};

export function loadInterests(): InterestSet {
  if (typeof localStorage === 'undefined') return emptyInterests();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { more: dedupeLabels(parsed?.more), less: dedupeLabels(parsed?.less) };
  } catch {
    return emptyInterests();
  }
}

export function saveInterests(value: InterestSet): void {
  // Through the shared writer, so a refused write keeps the labels for this session and the
  // optional backup file hears about the change.
  safeSetItem(STORAGE_KEY, JSON.stringify({
    more: dedupeLabels(value.more),
    less: dedupeLabels(value.less),
  }));
}

// Returns the same object when nothing changed, so callers can skip a state update.
export function addInterest(set: InterestSet, group: InterestGroup, rawLabel: string): InterestSet {
  const label = sanitizeLabel(rawLabel);
  if (!label) return set;
  if (set[group].length >= MAX_INTERESTS) return set;
  if ([...set.more, ...set.less].some(used => used.toLowerCase() === label.toLowerCase())) {
    return set;
  }
  return { ...set, [group]: [...set[group], label] };
}

export function removeInterest(set: InterestSet, group: InterestGroup, label: string): InterestSet {
  const next = set[group].filter(entry => entry.toLowerCase() !== label.toLowerCase());
  return next.length === set[group].length ? set : { ...set, [group]: next };
}

// The chips a row may offer: labels the reader has not taken on either list, each spelled once
// and in the order the sources gave them. One pass, so a folder chip named "Books" and the
// starter subject "Books" are the same chip.
export function unusedLabels(set: InterestSet, labels: string[]): string[] {
  const used = new Set([...set.more, ...set.less].map(label => label.toLowerCase()));
  const unrepeated = new Map<string, string>();
  labels.forEach(label => {
    const key = label.toLowerCase();
    if (!used.has(key) && !unrepeated.has(key)) unrepeated.set(key, label);
  });
  return [...unrepeated.values()];
}

// Folder names are the categories the reader already has; offering them avoids retyping.
export function suggestionsFromFolders(folders: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const folder of folders) {
    const label = sanitizeLabel(folder);
    const key = label.toLowerCase();
    if (!label || key === 'uncategorized' || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result.sort((a, b) => a.localeCompare(b));
}
