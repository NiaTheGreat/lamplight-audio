import { getObject, putObject } from "./storage";
import type { Book, LibraryEntry } from "../types";

/** Record that a chapter's narration is finished, so the library can show progress. */
export async function markNarrated(bookId: string, chapter: number): Promise<void> {
  const key = `library/${bookId}.json`;
  try {
    const raw = await getObject(key);
    // A fic read in Browse has no entry until it is narrated: this is what puts it on the Shelf.
    if (!raw) {
      if (!(await ensureLibraryEntry(bookId))) return;
      return markNarrated(bookId, chapter);
    }
    const entry = JSON.parse(raw.toString("utf8")) as LibraryEntry;
    const narrated = new Set(entry.narrated ?? []);
    if (narrated.has(chapter)) return;
    narrated.add(chapter);
    entry.narrated = [...narrated].sort((a, b) => a - b);
    await putObject(key, JSON.stringify(entry), "application/json");
  } catch {
    /* progress display is best-effort */
  }
}

/**
 * Make sure a stored book has a Shelf entry. A fic added through Browse has none until narration
 * starts. Returns false if the book isn't stored.
 */
export async function ensureLibraryEntry(bookId: string): Promise<boolean> {
  const key = `library/${bookId}.json`;
  if (await getObject(key)) return true;
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) return false;
  const book = JSON.parse(raw.toString("utf8")) as Book;
  const entry: LibraryEntry = {
    id: bookId,
    title: book.title,
    author: book.author,
    chapterCount: book.chapters.length,
    voice: book.voice,
    addedAt: Date.now(),
    narrated: [],
    chars: book.chapters.map((c) => c.text.length),
  };
  await putObject(key, JSON.stringify(entry), "application/json");
  return true;
}
