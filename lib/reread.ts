import { voiceFor } from "./chaptervoice";
import { getJob, isJobActive } from "./narration";
import { getLists } from "./pronlists";
import { applyPronunciations, effectiveLines } from "./pronunciation";
import { PronunciationError, updateFromList } from "./pronunciation-store";
import { sanitizeNarrator } from "./narrators-shared";
import { deleteObject, getObject, putObject } from "./storage";
import { audioKey } from "./tts";
import { splitForTts } from "./text";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "./types";

export type RereadOptions = {
  /** "keep" or undefined leaves the fic's list; "none" drops it; otherwise a named list's id. */
  listId?: unknown;
  /** Narrate this chapter in another voice. */
  voice?: unknown;
  /** With `voice`: also make it the voice for the whole fic from now on. */
  voiceForBook?: unknown;
};

async function loadBook(bookId: string): Promise<Book> {
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new PronunciationError("Book not found.", 404);
  return JSON.parse(raw.toString("utf8")) as Book;
}

async function deleteAudio(book: Book, index: number) {
  const voice = voiceFor(book, index);
  const spoken = applyPronunciations(book.chapters[index].text, effectiveLines(book));
  for (const key of [audioKey(spoken, voice), ...splitForTts(spoken).map((c) => audioKey(c, voice))]) {
    await deleteObject(key);
  }
}

/**
 * Throw away one narrated chapter's audio so it is narrated again (which costs money; the caller
 * shows the price first), optionally with another pronunciation list and/or another voice.
 * Works for any narrated chapter, e.g. after a bad take. Other chapters are never affected:
 * a list or whole-fic voice change pins them to what they were narrated with.
 */
export async function rereadChapter(
  bookId: string,
  index: unknown,
  opts: RereadOptions = {},
): Promise<{ chapter: number; voice: string }> {
  if (!BOOK_ID_RE.test(bookId)) throw new PronunciationError("Bad book id.", 400);
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new PronunciationError("Which chapter?", 400);
  }
  if (isJobActive(await getJob(bookId))) {
    throw new PronunciationError("Narration is running for this book. Pause or cancel it first.", 409);
  }
  const first = await loadBook(bookId);
  if (!first.chapters[index]) throw new PronunciationError("Chapter not found.", 404);

  const entryRaw = await getObject(`library/${bookId}.json`);
  const entry = entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null;
  if (!entry?.narrated?.includes(index)) throw new PronunciationError("That chapter isn't narrated yet.", 409);

  const voice = opts.voice === undefined || opts.voice === "" ? undefined : sanitizeNarrator(opts.voice);
  if (opts.voice !== undefined && opts.voice !== "" && !voice) throw new PronunciationError("Unknown narrator.", 400);

  // Remove what it was narrated as, before anything changes.
  await deleteAudio(first, index);

  // A different list: copy it in (this pins every other narrated chapter to its current lines).
  if (typeof opts.listId === "string" && opts.listId !== "" && opts.listId !== "keep") {
    const list = opts.listId === "none" ? null : (await getLists()).lists.find((l) => l.id === opts.listId);
    if (list === undefined) throw new PronunciationError("That list no longer exists.", 404);
    await updateFromList(bookId, list);
  }

  const book = await loadBook(bookId);
  if (book.frozen?.[index]) {
    delete book.frozen[index];
    if (Object.keys(book.frozen).length === 0) delete book.frozen;
  }

  if (voice) {
    const pinned = { ...(book.chapterVoices ?? {}) };
    if (opts.voiceForBook === true) {
      // Everything already narrated keeps the voice it has; the fic's voice changes for the rest.
      for (const i of entry.narrated) if (i !== index) pinned[i] = voiceFor(book, i);
      book.voice = voice;
      delete pinned[index];
    } else if (voice === book.voice) {
      delete pinned[index];
    } else {
      pinned[index] = voice;
    }
    for (const [i, v] of Object.entries(pinned)) if (v === book.voice) delete pinned[Number(i)];
    book.chapterVoices = Object.keys(pinned).length ? pinned : undefined;
  }
  await putObject(`books/${bookId}.json`, JSON.stringify(book), "application/json");

  // If nothing changed, the audio it will be narrated as is the audio just removed; clear any piece left.
  await deleteAudio(book, index);

  entry.narrated = entry.narrated.filter((i) => i !== index);
  entry.voice = book.voice;
  await putObject(`library/${bookId}.json`, JSON.stringify(entry), "application/json");
  return { chapter: index, voice: voiceFor(book, index) };
}
