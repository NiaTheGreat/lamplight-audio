import { parseEpub } from "../epub";
import type { Book } from "../types";
import { saveReaderBook } from "./store";

export type AttachResult = { ok: true } | { ok: false; error: string };

/**
 * Give a book that was added before the reader its EPUB. The file is only accepted if every
 * chapter's text is exactly what the book already holds, so nothing narrated can drift from the
 * page. Which "skip notes" setting the book was added with isn't recorded, so both are tried.
 */
export async function attachEpubToBook(book: Book, buf: Buffer): Promise<AttachResult> {
  let best: { skipNotes: boolean; bad: number[]; count: number } | null = null;
  for (const skipNotes of [true, false]) {
    let parsed: Book;
    try {
      parsed = await parseEpub(buf, { skipNotes, format: true });
    } catch {
      return { ok: false, error: "That file isn't a readable EPUB." };
    }
    const bad: number[] = [];
    const n = Math.max(parsed.chapters.length, book.chapters.length);
    for (let i = 0; i < n; i++) {
      if (parsed.chapters[i]?.text !== book.chapters[i]?.text) bad.push(i + 1);
    }
    if (bad.length === 0) {
      await saveReaderBook(
        book.id,
        buf,
        parsed.chapters.map((c) => c.paras ?? []),
      );
      return { ok: true };
    }
    if (!best || bad.length < best.bad.length)
      best = { skipNotes, bad, count: parsed.chapters.length };
  }
  const shown = best!.bad.slice(0, 6).join(", ");
  return {
    ok: false,
    error:
      best!.count !== book.chapters.length
        ? `That EPUB has ${best!.count} chapters but this book has ${book.chapters.length}, so it isn't the same file. Add it as a new book instead; chapters with the same text reuse their audio.`
        : `Chapter${best!.bad.length > 1 ? "s" : ""} ${shown}${best!.bad.length > 6 ? "…" : ""} read differently in that EPUB, so it isn't the same file. Add it as a new book instead; unchanged chapters reuse their audio.`,
  };
}
