import { getObject, putObject } from "./storage";

export type BookPosition = { chapter: number; time: number; updatedAt: number };
export type Progress = {
  /** The book listened to most recently. */
  last: ({ id: string } & BookPosition) | null;
  books: Record<string, BookPosition>;
};

const KEY = "progress.json";

export async function getProgress(): Promise<Progress> {
  const raw = await getObject(KEY);
  if (!raw) return { last: null, books: {} };
  try {
    const p = JSON.parse(raw.toString("utf8")) as Progress;
    return { last: p.last ?? null, books: p.books ?? {} };
  } catch {
    return { last: null, books: {} };
  }
}

/** Record a listening position. Single user, so a plain read-modify-write is fine. */
export async function savePosition(
  id: string,
  chapter: number,
  time: number,
): Promise<Progress> {
  const progress = await getProgress();
  const pos: BookPosition = {
    chapter: Math.max(0, Math.floor(chapter)),
    time: Math.max(0, Math.floor(time)),
    updatedAt: Date.now(),
  };
  progress.books[id] = pos;
  progress.last = { id, ...pos };
  await putObject(KEY, JSON.stringify(progress), "application/json");
  return progress;
}
