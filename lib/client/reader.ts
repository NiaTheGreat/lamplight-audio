import type { ReaderChapterData } from "../reader/types";

export type ReaderStatus = { enabled: boolean; hasEpub: boolean };

/** Is the reader on, and does this book have its EPUB saved? Never throws: the reader just stays hidden. */
export async function getReaderStatus(bookId: string): Promise<ReaderStatus> {
  try {
    const res = await fetch(`/api/reader/${bookId}`, { cache: "no-store" });
    if (!res.ok) return { enabled: false, hasEpub: false };
    return (await res.json()) as ReaderStatus;
  } catch {
    return { enabled: false, hasEpub: false };
  }
}

export async function getReaderChapter(
  bookId: string,
  chapter: number,
): Promise<ReaderChapterData | null> {
  try {
    const res = await fetch(`/api/reader/${bookId}/${chapter}`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as ReaderChapterData) : null;
  } catch {
    return null;
  }
}

/** Attach the EPUB to a book that was added before the reader. Returns an error message, or null. */
export async function attachEpub(bookId: string, file: File): Promise<string | null> {
  const form = new FormData();
  form.set("file", file);
  try {
    const res = await fetch(`/api/reader/${bookId}`, { method: "POST", body: form });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error || "Couldn't attach that file.";
  } catch {
    return "Couldn't attach that file.";
  }
}
