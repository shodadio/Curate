export interface ReadableDigestCandidate {
  id: string;
  source?: string;
  articleUnavailable?: boolean;
}

// An edition is selected before page fetches confirm which articles can actually be read. Remove
// those failures and keep drawing from the ranked pool until the requested number of readable
// stories is reached, while retaining the selector's per-source cap and fallback behavior.
export async function buildReadableDigest<T extends ReadableDigestCandidate>(
  selected: T[],
  ranked: T[],
  itemCount: number,
  maxPerSource: number,
  enrich: (items: T[]) => Promise<T[]>,
  batchSize = 6,
): Promise<T[]> {
  const targetCount = Math.max(0, Math.trunc(itemCount) || 0);
  if (targetCount === 0) return [];

  const cap = Math.max(1, Math.trunc(maxPerSource) || 1);
  const batchLimit = Math.max(1, Math.trunc(batchSize) || 1);
  const result: T[] = [];
  const includedIds = new Set<string>();
  const attemptedIds = new Set<string>();
  const sourceCounts = new Map<string, number>();

  const include = (item: T, enforceCap: boolean): void => {
    if (!item?.id || item.articleUnavailable || includedIds.has(item.id) || result.length >= targetCount) return;
    const source = item.source || 'Unknown';
    if (enforceCap && (sourceCounts.get(source) || 0) >= cap) return;
    includedIds.add(item.id);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    result.push(item);
  };

  const enrichBatch = async (batch: T[], enforceCap: boolean): Promise<void> => {
    batch.forEach(item => attemptedIds.add(item.id));
    const enriched = await enrich(batch);
    const byId = new Map(enriched.map(item => [item.id, item]));
    batch.forEach(candidate => include(byId.get(candidate.id) || candidate, enforceCap));
  };

  for (let start = 0; start < selected.length && result.length < targetCount; start += batchLimit) {
    const batch = selected
      .slice(start, start + batchLimit)
      .filter(item => item?.id && !attemptedIds.has(item.id));
    if (batch.length > 0) await enrichBatch(batch, true);
  }

  const nextBatch = (enforceCap: boolean): T[] => {
    const reservedCounts = new Map(sourceCounts);
    const batch: T[] = [];
    for (const candidate of ranked) {
      if (!candidate?.id || attemptedIds.has(candidate.id) || includedIds.has(candidate.id)) continue;
      if (candidate.articleUnavailable) {
        attemptedIds.add(candidate.id);
        continue;
      }
      const source = candidate.source || 'Unknown';
      if (enforceCap && (reservedCounts.get(source) || 0) >= cap) continue;
      batch.push(candidate);
      reservedCounts.set(source, (reservedCounts.get(source) || 0) + 1);
      if (batch.length >= batchLimit) break;
    }
    return batch;
  };

  while (result.length < targetCount) {
    const cappedBatch = nextBatch(true);
    const batch = cappedBatch.length > 0 ? cappedBatch : nextBatch(false);
    if (batch.length === 0) break;
    await enrichBatch(batch, cappedBatch.length > 0);
  }

  return result;
}
