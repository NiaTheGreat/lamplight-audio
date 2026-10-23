import { voiceFor } from "./chaptervoice";
import { getJob, isJobActive } from "./narration";
import { getObject, putObject } from "../storage/storage";
import { sanitizeNarrator } from "../narrators-shared";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "../types";

export class NarratorChangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function loadBookAndEntry(bookId: string) {
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new NarratorChangeError("Book not found.", 404);
  const entryRaw = await getObject(`library/${bookId}.json`);
  return {
    book: JSON.parse(raw.toString("utf8")) as Book,
    entry: entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null,
  };
}

async function assertIdle(bookId: string) {
  if (isJobActive(await getJob(bookId))) {
    throw new NarratorChangeError(
      "Narration is running for this book. Pause or cancel it first.",
      409,
    );
  }
}

/**
 * Change who narrates a book from now on. Chapters already narrated keep the voice they were
 * narrated in (pinned in `chapterVoices`), so nothing paid for becomes unready and a half-listened
 * story doesn't change voice behind you; only chapters narrated later use the new one.
 */
export async function changeNarrator(bookId: string, narratorId: unknown): Promise<string> {
  if (!BOOK_ID_RE.test(bookId)) throw new NarratorChangeError("Bad book id.", 400);
  const narrator = sanitizeNarrator(narratorId);
  if (!narrator) throw new NarratorChangeError("Unknown narrator.", 400);
  await assertIdle(bookId);

  const { book, entry } = await loadBookAndEntry(bookId);
  const pinned = { ...(book.chapterVoices ?? {}) };
  for (const i of entry?.narrated ?? []) {
    const was = voiceFor(book, i);
    if (was !== narrator) pinned[i] = was;
  }
  book.voice = narrator;
  for (const [i, v] of Object.entries(pinned)) if (v === narrator) delete pinned[Number(i)];
  book.chapterVoices = Object.keys(pinned).length ? pinned : undefined;
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
  if (entry) {
    entry.voice = narrator;
    await putObject(`library/${bookId}.json`, JSON.stringify(entry), "application/json");
  }
  return narrator;
}

/**
 * Narrate these chapters in another voice, leaving the fic's own voice alone. Only chapters not
 * narrated yet are affected; narrated ones keep the voice they have.
 */
export async function setChapterVoice(
  bookId: string,
  indices: number[],
  narratorId: unknown,
): Promise<void> {
  if (!BOOK_ID_RE.test(bookId)) throw new NarratorChangeError("Bad book id.", 400);
  const narrator = sanitizeNarrator(narratorId);
  if (!narrator) throw new NarratorChangeError("Unknown narrator.", 400);
  await assertIdle(bookId);

  const { book, entry } = await loadBookAndEntry(bookId);
  const done = new Set(entry?.narrated ?? []);
  const pinned = { ...(book.chapterVoices ?? {}) };
  for (const i of indices) {
    if (done.has(i)) continue;
    if (narrator === book.voice) delete pinned[i];
    else pinned[i] = narrator;
  }
  book.chapterVoices = Object.keys(pinned).length ? pinned : undefined;
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
}
