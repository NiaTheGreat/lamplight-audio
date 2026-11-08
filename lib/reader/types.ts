/**
 * The reader's copy of a chapter. Client-safe. The text of the paragraphs (breaks left out),
 * joined with a blank line, is exactly the chapter text that gets narrated, so the page and the
 * audio can be matched sentence by sentence (see timeline.ts).
 */
export type Run = { t: string; i?: true; b?: true };

export type Para = {
  runs: Run[];
  /** "quote" = inside a block quote, "heading" = the chapter title read aloud, "break" = a scene break (not narrated). */
  kind?: "quote" | "heading" | "break";
};

/** One book's reader data, as saved in `reader/<bookId>.json`. */
export type ReaderBook = { v: 1; chapters: Para[][] };

/** What `GET /api/reader/[id]/[chapter]` returns. */
export type ReaderChapterData = {
  chapter: number;
  title: string;
  paras: Para[];
  /** Start time (seconds) of each sentence, in `splitSentences(paras)` order; null when no timing is known. */
  times: number[] | null;
  /** Length of the audio the times were measured on. */
  total: number | null;
  /** The chapter has been narrated. */
  narrated: boolean;
  /** The paragraphs come with italics and scene breaks (false = plain text only). */
  formatted: boolean;
};
