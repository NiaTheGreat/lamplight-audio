import { getObject, putObject } from "./storage";

/**
 * Narrations that are happening because someone pressed play (not a background job), so the
 * queue can show everything being narrated. One small file; written when a chapter's narration
 * starts and again when it ends. Entries not refreshed for 6 minutes are ignored (a crashed run).
 */
export type Live = { bookId: string; chapter: number; startedAt: number };

const KEY = "jobs/live.json";
const STALE_MS = 6 * 60 * 1000;

async function read(): Promise<Live[]> {
  const raw = await getObject(KEY);
  return raw ? (JSON.parse(raw.toString("utf8")) as Live[]) : [];
}

export async function setLive(bookId: string, chapter: number, on: boolean): Promise<void> {
  try {
    const now = Date.now();
    const rest = (await read()).filter(
      (l) => !(l.bookId === bookId && l.chapter === chapter) && now - l.startedAt < STALE_MS,
    );
    await putObject(KEY, JSON.stringify(on ? [...rest, { bookId, chapter, startedAt: now }] : rest), "application/json");
  } catch {
    /* the queue view is a convenience */
  }
}

export async function listLive(): Promise<Live[]> {
  try {
    const now = Date.now();
    return (await read()).filter((l) => now - l.startedAt < STALE_MS);
  } catch {
    return [];
  }
}
