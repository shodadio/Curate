// A story may arrive more than once when two subscriptions point to the same publication.
// Its stable id is the identity shared by those copies; items without an id cannot be compared.
export function deduplicateFeedArticles<T extends object>(articles: T[]): T[] {
  const seen = new Set<string>();
  return articles.filter(article => {
    const rawId = (article as { id?: unknown }).id;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
