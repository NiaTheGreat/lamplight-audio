export type Chapter = {
  index: number;
  title: string;
  text: string;
};

export type Book = {
  id: string;
  title: string;
  author?: string;
  /** Voice this book is narrated in; fixed when first added. */
  voice?: string;
  chapters: Chapter[];
  /**
   * Narrators for individual chapters that differ from `voice`: a chapter re-read in another
   * voice, or chapters narrated before the whole fic switched voice. See lib/chaptervoice.ts.
   */
  chapterVoices?: Record<number, string>;
  /** A named list copied into the book at upload; later edits to the list don't reach the book. */
  pronList?: { id: string; name: string; lines: { from: string; to: string }[] };
  /** How to say certain words, applied before narration (see lib/pronunciation.ts). */
  pronunciations?: { from: string; to: string }[];
  /**
   * Narrated chapters keep the lines they were narrated with when the list changes, so edits
   * never silently make paid-for audio "unready". Re-narrating a chapter drops its entry here.
   */
  frozen?: Record<number, { from: string; to: string }[]>;
};

export type BookSummary = {
  id: string;
  title: string;
  author?: string;
  voice?: string;
  /** Chapters narrated in a voice other than `voice`. */
  chapterVoices?: Record<number, string>;
  /** Chapter indexes with finished narration (from the library entry). */
  narrated?: number[];
  chapters: { index: number; title: string; chars: number }[];
};

export function summarize(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    voice: book.voice,
    chapterVoices: book.chapterVoices,
    chapters: book.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      chars: c.text.length,
    })),
  };
}

export const BOOK_ID_RE = /^[a-f0-9]{16}$/;

/** One entry in the saved library of uploaded books. */
export type LibraryEntry = {
  id: string;
  title: string;
  author?: string;
  chapterCount: number;
  voice?: string;
  addedAt: number;
  /** Chapter indexes whose narration is finished and cached. */
  narrated?: number[];
  /** Characters in each chapter, so the shelf can estimate what's left to narrate. */
  chars?: number[];
};
