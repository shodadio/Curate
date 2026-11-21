// A story's id has to name the story, not its publication. The first scheme hashed only the
// opening characters of a link, which every article on a site shares: an edition could hold one
// card per publication, and opening one story marked the rest of that site's stories as read.
//
// The same function mints ids on the server and rewrites them in the browser, so it is plain
// arithmetic rather than a platform hash.

export const STORY_ID_PREFIX = 'live_';

// Two FNV-1a passes with different bases, in base 36: one id that is stable for the same link
// and distinct for different ones.
const fnv1a = (input: string, basis: number): string => {
  let hash = basis >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
};

// The link identifies the piece; the title only stands in for feeds that publish without links.
// A heading rewritten upstream must not turn one story into a new one.
export function storyIdFor(link: string, title: string): string {
  const identity = (link || '').trim() || (title || '').trim();
  if (!identity) return '';
  return `${STORY_ID_PREFIX}${fnv1a(identity, 2166136261)}${fnv1a(identity, 709392143)}`;
}

// Two hashes of seven base-36 characters each, so an id from this scheme is exactly this shape.
// Anything else under the prefix was minted by the old, one-per-publication scheme.
const STORY_ID_SHAPE = /^live_[0-9a-z]{14}$/;

export const isStoryId = (value: string): boolean => STORY_ID_SHAPE.test(value);

// What the old scheme produced for a link: the opening of its base64 form, which every story on
// a publication shares. Only used to recognise records written before this scheme, so those
// stories stay out of a new edition even when their own entry is no longer stored.
export function legacyStoryIdFor(link: string, title: string): string {
  const identity = (link || '').trim() || (title || '').trim();
  if (!identity) return '';
  let base64 = '';
  try {
    base64 = btoa(identity);
  } catch {
    // Not Latin-1 (title-based identity): the old scheme hashed its UTF-8 bytes, which is not
    // worth reproducing for the handful of feeds that publish without links.
    return '';
  }
  return `${STORY_ID_PREFIX}${base64.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)}`;
}
