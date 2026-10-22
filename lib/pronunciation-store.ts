import { clearKeys } from "./keys";
import { getJob, isJobActive } from "./narration";
import { applyPronunciations, effectiveLines, linesFor, sanitizeLines, spokenText, type Pron } from "./pronunciation";
import { getObject, putObject } from "./storage";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "./types";

export class PronunciationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type StaleChapter = { index: number; title: string; chars: number };

async function load(bookId: string): Promise<{ book: Book; entry: LibraryEntry | null }> {
  if (!BOOK_ID_RE.test(bookId)) throw new PronunciationError("Bad book id.", 400);
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new PronunciationError("Book not found.", 404);
  const entryRaw = await getObject(`library/${bookId}.json`);
  return {
    book: JSON.parse(raw.toString("utf8")) as Book,
    entry: entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null,
  };
}

async function assertIdle(bookId: string) {
  const job = await getJob(bookId);
  if (isJobActive(job)) {
    throw new PronunciationError("Narration is running for this book. Pause or cancel it first.", 409);
  }
}

/** Narrated chapters that were read with different lines than the book's current ones. */
function stale(book: Book, entry: LibraryEntry | null): StaleChapter[] {
  const narrated = new Set(entry?.narrated ?? []);
  return book.chapters
    .filter((c) => narrated.has(c.index) && book.frozen?.[c.index])
    .filter((c) => spokenText(book, c.index, c.text) !== applyPronunciations(c.text, effectiveLines(book)))
    .map((c) => ({ index: c.index, title: c.title, chars: c.text.length }));
}

export async function getPronunciations(bookId: string) {
  const { book, entry } = await load(bookId);
  return { lines: book.pronunciations ?? [], list: book.pronList ?? null, stale: stale(book, entry) };
}

/**
 * Change a book's lines (its own, or the copied list). Chapters already narrated keep the lines
 * they were narrated with (their audio stays ready and nothing is spent); chapters not narrated
 * yet use the new ones.
 */
async function change(bookId: string, mutate: (book: Book) => void) {
  await assertIdle(bookId);
  const { book, entry } = await load(bookId);
  const before = effectiveLines(book);
  mutate(book);
  const after = effectiveLines(book);

  const narrated = new Set(entry?.narrated ?? []);
  for (const c of book.chapters) {
    if (!narrated.has(c.index) || book.frozen?.[c.index]) continue;
    // Pin the lines this chapter was narrated under, but only if the change would alter it.
    if (applyPronunciations(c.text, before) !== applyPronunciations(c.text, after)) {
      (book.frozen ??= {})[c.index] = before;
    }
  }
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
  return { lines: book.pronunciations ?? [], list: book.pronList ?? null, stale: stale(book, entry) };
}

/** Replace the book's own lines. */
export function savePronunciations(bookId: string, input: unknown) {
  const lines = sanitizeLines(input);
  return change(bookId, (book) => {
    book.pronunciations = lines.length ? lines : undefined;
  });
}

/** Re-copy the named list into the book (it changes only what's not narrated yet, until re-read). */
export function updateFromList(bookId: string, list: { id: string; name: string; lines: Pron[] } | null) {
  return change(bookId, (book) => {
    book.pronList = list ? { id: list.id, name: list.name, lines: list.lines } : undefined;
  });
}

/**
 * Re-read some chapters with the current lines. They stop being "narrated" until they're read
 * again (which costs money, so the caller shows the price first).
 */
export async function renarrate(bookId: string, chapters: unknown) {
  await assertIdle(bookId);
  const { book, entry } = await load(bookId);
  const staleIdx = stale(book, entry).map((c) => c.index);
  const wanted = Array.isArray(chapters)
    ? staleIdx.filter((i) => chapters.includes(i))
    : staleIdx;
  for (const i of wanted) delete book.frozen?.[i];
  await clearKeys(bookId, wanted);
  if (book.frozen && Object.keys(book.frozen).length === 0) delete book.frozen;
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
  if (entry) {
    entry.narrated = (entry.narrated ?? []).filter((i) => !wanted.includes(i));
    await putObject(`library/${bookId}.json`, JSON.stringify(entry), "application/json");
  }
  return { renarrate: wanted, ...(await getPronunciations(bookId)) };
}
