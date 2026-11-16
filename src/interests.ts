// User-declared interests: the only part of the reading profile the reader states directly.
// Votes stay learned (semantic feedback); interests stay explicit, editable and reversible.

export type InterestGroup = 'more' | 'less';

export interface InterestSet {
  more: string[];
  less: string[];
}

export const MAX_INTERESTS = 12;

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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      more: dedupeLabels(value.more),
      less: dedupeLabels(value.less),
    }));
  } catch {
    /* private mode or full quota: interests simply stay in memory */
  }
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
