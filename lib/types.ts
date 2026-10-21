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
};

export type BookSummary = {
  id: string;
  title: string;
  author?: string;
  voice?: string;
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
};
