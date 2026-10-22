import { getJob, isJobActive } from "./narration";
import { getObject, putObject } from "./storage";
import { sanitizeNarrator } from "./narrators-shared";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "./types";

export class NarratorChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Change who narrates a book. Only allowed while nothing has been narrated and no
 * background job is running: a half-listened book should never change narrator, and
 * once audio exists the old narrator's cached chapters would no longer be "ready".
 */
export async function changeNarrator(bookId: string, narratorId: unknown): Promise<string> {
  if (!BOOK_ID_RE.test(bookId)) throw new NarratorChangeError("Bad book id.", 400);
  const narrator = sanitizeNarrator(narratorId);
  if (!narrator) throw new NarratorChangeError("Unknown narrator.", 400);

  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new NarratorChangeError("Book not found.", 404);
  const book = JSON.parse(raw.toString("utf8")) as Book;

  const entryRaw = await getObject(`library/${bookId}.json`);
  const entry = entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null;
  if ((entry?.narrated?.length ?? 0) > 0) {
    throw new NarratorChangeError("Some chapters are already narrated, so this book keeps its narrator.", 409);
  }
  const job = await getJob(bookId);
  if (isJobActive(job)) {
    throw new NarratorChangeError("Narration is running for this book. Stop it first.", 409);
  }

  book.voice = narrator;
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
  if (entry) {
    entry.voice = narrator;
    await putObject(`library/${bookId}.json`, JSON.stringify(entry), "application/json");
  }
  return narrator;
}
