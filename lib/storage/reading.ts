import type { ReadingEntry } from "../catalog/meta";
import { getObject, putObject } from "./storage";

/**
 * Where the reader has got to in each fic (the Read view), for Browse's Unread / Reading /
 * Finished. One small file, read-modify-write, like `progress.json` (single user).
 */
const KEY = "reading.json";
export type Reading = Record<string, ReadingEntry>;

export async function getReading(): Promise<Reading> {
  const raw = await getObject(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as Reading;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export type ReadingUpdate = {
  id: string;
  chapter?: number;
  /** The chapter was read to its end. */
  done?: boolean;
  /** Chapters in the fic, so reaching the end of the last one counts as finished. */
  total?: number;
  /** true: mark finished. false: mark unread. */
  finished?: boolean;
};

export async function saveReading(u: ReadingUpdate): Promise<ReadingEntry> {
  const all = await getReading();
  const now = Date.now();
  const prev = all[u.id];
  const entry: ReadingEntry = prev ?? { chapter: 0, done: [], updatedAt: now };
  if (typeof u.chapter === "number") {
    entry.chapter = Math.max(0, Math.floor(u.chapter));
    // Reading again after "mark unread" starts a new read.
    if (entry.finished === false) delete entry.finished;
    if (u.done && !entry.done.includes(entry.chapter)) {
      entry.done = [...entry.done, entry.chapter].sort((a, b) => a - b);
    }
    if (u.done && u.total && entry.chapter >= u.total - 1) entry.finished = true;
  }
  if (u.finished === true) entry.finished = true;
  if (u.finished === false) {
    entry.finished = false;
    entry.done = [];
  }
  entry.updatedAt = now;
  all[u.id] = entry;
  await putObject(KEY, JSON.stringify(all), "application/json");
  return entry;
}
