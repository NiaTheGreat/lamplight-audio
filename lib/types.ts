export type Chapter = {
  index: number;
  title: string;
  text: string;
};

export type Book = {
  id: string;
  title: string;
  author?: string;
  chapters: Chapter[];
};

export type BookSummary = {
  id: string;
  title: string;
  author?: string;
  chapters: { index: number; title: string; chars: number }[];
};

export function summarize(book: Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    chapters: book.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      chars: c.text.length,
    })),
  };
}

export const BOOK_ID_RE = /^[a-f0-9]{16}$/;
