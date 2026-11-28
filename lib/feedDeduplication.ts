// Every watched feed lands in one stream, so the same story can arrive more than once: two
// subscriptions to one publication, an item a feed lists twice, a post syndicated under two
// names. Its id is minted from the piece's own link, so those copies share it and one is enough.
// An article with no id gives nothing to compare, so it is kept rather than dropped as a repeat.
export function deduplicateFeedArticles<T extends { id?: unknown }>(articles: T[]): T[] {
  const seen = new Set<string>();
  return articles.filter(article => {
    const id = typeof article?.id === 'string' ? article.id.trim() : '';
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
