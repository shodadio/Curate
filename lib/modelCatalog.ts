export type ModelCatalogKind = 'chat' | 'embedding';

export interface ModelCatalogOption {
  id: string;
  name?: string;
  promptPerMillion?: number;
  completionPerMillion?: number;
  endpoints?: string[];
}

function ratePerMillion(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 ? rate * 1_000_000 : undefined;
}

export function normalizeModelCatalog(
  entries: unknown[],
  options: { openRouter?: boolean; kind?: ModelCatalogKind } = {},
): ModelCatalogOption[] {
  const byId = new Map<string, ModelCatalogOption>();

  for (const entry of entries) {
    const id = typeof entry === 'string'
      ? entry.trim()
      : typeof (entry as any)?.id === 'string'
        ? (entry as any).id.trim()
        : '';
    if (!id || byId.has(id)) continue;

    const pricing = typeof entry === 'object' && entry !== null ? (entry as any).pricing : undefined;
    const endpoints = typeof entry === 'object' && entry !== null && Array.isArray((entry as any).endpoints)
      ? (entry as any).endpoints.filter((endpoint: unknown): endpoint is string => typeof endpoint === 'string')
      : undefined;
    const name = typeof entry === 'object' && entry !== null && typeof (entry as any).name === 'string'
      ? (entry as any).name.trim()
      : '';

    const promptPerMillion = ratePerMillion(pricing?.prompt);
    const completionPerMillion = ratePerMillion(pricing?.completion);
    byId.set(id, {
      id,
      ...(name ? { name } : {}),
      ...(promptPerMillion !== undefined ? { promptPerMillion } : {}),
      ...(completionPerMillion !== undefined ? { completionPerMillion } : {}),
      ...(endpoints ? { endpoints } : {}),
    });
  }

  let models = Array.from(byId.values());
  const hasOpenRouterEndpoints = options.openRouter && models.some(model => (model.endpoints?.length || 0) > 0);
  if (hasOpenRouterEndpoints) {
    const endpoint = options.kind === 'embedding' ? '/api/v1/embeddings' : '/api/v1/chat/completions';
    models = models.filter(model => model.endpoints?.includes(endpoint));
  }

  models.sort((a, b) => {
    if (options.openRouter) {
      const aPriced = a.promptPerMillion !== undefined && a.completionPerMillion !== undefined;
      const bPriced = b.promptPerMillion !== undefined && b.completionPerMillion !== undefined;
      if (aPriced !== bPriced) return aPriced ? -1 : 1;
      if (aPriced && bPriced) {
        const priceDifference = (a.promptPerMillion! + a.completionPerMillion!) - (b.promptPerMillion! + b.completionPerMillion!);
        if (priceDifference !== 0) return priceDifference;
      }
    }
    return a.id.localeCompare(b.id);
  });

  return models.slice(0, 500);
}
