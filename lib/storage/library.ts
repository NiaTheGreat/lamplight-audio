import { getObject, putObject } from "./storage";
import type { LibraryEntry } from "../types";

/** Record that a chapter's narration is finished, so the library can show progress. */
export async function markNarrated(bookId: string, chapter: number): Promise<void> {
  const key = `library/${bookId}.json`;
  try {
    const raw = await getObject(key);
    if (!raw) return;
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
