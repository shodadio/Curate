// The starter library, shared by the client and the server so a first-run digest draws on
// exactly what the server falls back to. Ids are stable, because "mark as read" and source
// descriptions are stored against them.

export interface DefaultFeed {
  id: string;
  title: string;
  feedUrl: string;
  folder: string;
}

export const DEFAULT_FEEDS: DefaultFeed[] = [
  { id: 'src_mr', title: 'Marginal Revolution', feedUrl: 'https://marginalrevolution.com/feed', folder: 'Economics' },
  { id: 'src_dl', title: 'Dan Luu', feedUrl: 'https://danluu.com/atom.xml', folder: 'Tech & Engineering' },
  { id: 'src_sw', title: 'Simon Willison', feedUrl: 'https://simonwillison.net/atom/entries/', folder: 'Software & AI' },
  { id: 'src_at', title: 'Ars Technica', feedUrl: 'https://feeds.arstechnica.com/arstechnica/index', folder: 'Tech & Policy' },
  { id: 'src_st', title: 'Stratechery', feedUrl: 'https://stratechery.com/feed/', folder: 'Tech & Strategy' },
  { id: 'src_ala', title: 'A List Apart', feedUrl: 'https://alistapart.com/main/feed/', folder: 'Design & Craft' },
  { id: 'src_aeon', title: 'Aeon Magazine', feedUrl: 'https://aeon.co/feed.rss', folder: 'Philosophy & Culture' },
  { id: 'src_row', title: 'Rest of World', feedUrl: 'https://restofworld.org/feed/latest', folder: 'Global Tech' },
];
