import { getJob, isJobActive } from "./narration";
import { effectiveLines, applyPronunciations } from "./pronunciation";
import { PronunciationError } from "./pronunciation-store";
import { deleteObject, getObject, putObject } from "./storage";
import { audioKey, defaultVoice } from "./tts";
import { splitForTts } from "./text";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "./types";

/**
 * Throw away one narrated chapter's audio so it is narrated again the next time it's played
 * (which costs money; the caller shows the price first). The chapter then uses the book's
 * current pronunciation lines. Works for any narrated chapter, e.g. after a bad take.
 */
export async function rereadChapter(bookId: string, index: unknown): Promise<{ chapter: number }> {
  if (!BOOK_ID_RE.test(bookId)) throw new PronunciationError("Bad book id.", 400);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new PronunciationError("Which chapter?", 400);
  }
  const job = await getJob(bookId);
  if (isJobActive(job)) {
    throw new PronunciationError("Narration is running for this book. Pause or cancel it first.", 409);
  }
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new PronunciationError("Book not found.", 404);
  const book = JSON.parse(raw.toString("utf8")) as Book;
  const ch = book.chapters[index];
  if (!ch) throw new PronunciationError("Chapter not found.", 404);

  const entryRaw = await getObject(`library/${bookId}.json`);
  const entry = entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null;
  if (!entry?.narrated?.includes(index)) throw new PronunciationError("That chapter isn't narrated yet.", 409);

  // Forget what it was pinned to, then remove the audio it would use now (whole chapter and chunks).
  const voice = book.voice ?? defaultVoice();
  if (book.frozen?.[index]) {
    delete book.frozen[index];
    if (Object.keys(book.frozen).length === 0) delete book.frozen;
    await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");
  }
  const spoken = applyPronunciations(ch.text, effectiveLines(book));
  for (const key of [audioKey(spoken, voice), ...splitForTts(spoken).map((c) => audioKey(c, voice))]) {
    await deleteObject(key);
  }

  entry.narrated = entry.narrated.filter((i) => i !== index);
  await putObject(`library/${bookId}.json`, JSON.stringify(entry), "application/json");
  return { chapter: index };
}
