import { getJob, isJobActive } from "./narration";
import { PronunciationError } from "./pronunciation-store";
import { spokenText } from "./pronunciation";
import { getObject, putObject } from "./storage";
import { splitForTts } from "./text";
import { voiceFor } from "./chaptervoice";
import { audioKey, joinMp3 } from "./tts";
import { BOOK_ID_RE, type Book, type LibraryEntry } from "./types";

/**
 * Re-join every narrated chapter from its saved pieces with the tags and length headers stripped
 * (see lib/mp3.ts). Costs no narration, only storage reads and one write per chapter. Fixes
 * chapters made before the stripping existed, where seeking jumped back to the start.
 */
export async function repairBook(bookId: string): Promise<{ rebuilt: number; skipped: number }> {
  if (!BOOK_ID_RE.test(bookId)) throw new PronunciationError("Bad book id.", 400);
  if (isJobActive(await getJob(bookId))) {
    throw new PronunciationError("Narration is running for this book. Pause or cancel it first.", 409);
  }
  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) throw new PronunciationError("Book not found.", 404);
  const book = JSON.parse(raw.toString("utf8")) as Book;
  const entryRaw = await getObject(`library/${bookId}.json`);
  const entry = entryRaw ? (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry) : null;

  let rebuilt = 0;
  let skipped = 0;
  for (const index of entry?.narrated ?? []) {
    const ch = book.chapters[index];
    if (!ch) continue;
    const voice = voiceFor(book, index);
    const spoken = spokenText(book, index, ch.text);
    const pieces: Buffer[] = [];
    for (const chunk of splitForTts(spoken)) {
      const piece = await getObject(audioKey(chunk, voice));
      if (!piece) break;
      pieces.push(piece);
    }
    if (pieces.length === 0 || pieces.length !== splitForTts(spoken).length) {
      skipped++; // pieces are gone; leave the finished file as it is
      continue;
    }
    await putObject(audioKey(spoken, voice), joinMp3(pieces), "audio/mpeg");
    rebuilt++;
  }
  return { rebuilt, skipped };
}
