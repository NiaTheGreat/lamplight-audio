/**
 * What the Browse view knows about a fic besides its text. Every field is optional because EPUBs
 * differ a lot: an AO3 download carries rating, tags and stats, while an EPUB exported by other
 * tools may carry only a title, a summary and one fandom. Client-safe (no parsing code here).
 */
export type FicMeta = {
  summary?: string;
  fandoms?: string[];
  rating?: string;
  /** AO3 category: F/F, F/M, M/M, Gen, Multi, Other. */
  category?: string[];
  warnings?: string[];
  relationships?: string[];
  characters?: string[];
  tags?: string[];
  series?: string;
  /** Language name, e.g. "English". */
  language?: string;
  /** Words as the author's site counts them when the file says so, otherwise counted from the text. */
  words?: number;
  chaptersDone?: number;
  /** Undefined when the author hasn't fixed a total ("3/?"). */
  chaptersTotal?: number;
  /** Undefined when the file doesn't say. */
  complete?: boolean;
  /** YYYY-MM-DD */
  published?: string;
  /** YYYY-MM-DD: last update, or the completion date. */
  updated?: string;
  /** AO3 work number, when the file names one (identifier `urn:ao3:<n>`). */
  workId?: string;
  /** Where the details came from. */
  source: "ao3-preface" | "epub";
};

export const ao3WorkUrl = (workId: string) => `https://archiveofourown.org/works/${workId}`;

/** Words in a text, the way a word counter would count them. */
export function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

/** One fic in the Browse list: what's needed to show a card and filter, kept small. */
export type CatalogItem = {
  id: string;
  title: string;
  author?: string;
  /** Clipped for the list; the full text is in `catalog/<id>.json`. */
  summary?: string;
  fandoms?: string[];
  rating?: string;
  category?: string[];
  warnings?: string[];
  relationships?: string[];
  characters?: string[];
  tags?: string[];
  series?: string;
  language?: string;
  words: number;
  /** Characters of narrated text, for the price of narrating it. */
  chars: number;
  chapters: number;
  chaptersTotal?: number;
  complete?: boolean;
  published?: string;
  updated?: string;
  workId?: string;
  /** "none": nothing but a title, made from a shelf entry until its details are read. */
  source: FicMeta["source"] | "none";
  addedAt: number;
  /** Tags the reader added by hand. */
  userTags?: string[];
  /** "Mark complete" / "mark in progress" by hand; wins over the file. */
  completeOverride?: boolean;
};

/** Where the reader has got to in one fic (kept on the server so every device agrees). */
export type ReadingEntry = {
  /** Chapter to continue from (0-based). */
  chapter: number;
  /** Chapters read to their end. */
  done: number[];
  /** true: finished (reached the end, or marked); false: marked unread. */
  finished?: boolean;
  updatedAt: number;
};
