import { getObject, putObject } from "./storage";

export type BookPosition = {
  chapter: number;
  time: number;
  updatedAt: number;
  /** Where the listener got to in each chapter they left part-way (seconds, by chapter index). */
  chapters?: Record<string, number>;
};
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
  /** A chapter that was listened to the end: forget its spot so it starts from the top. */
  clear?: number,
  /** When the device recorded it (ms). A save older than the one stored is a late arrival: ignored. */
  at?: number,
): Promise<Progress> {
  const progress = await getProgress();
  const when =
    typeof at === "number" && Number.isFinite(at) && at > 0
      ? Math.min(Math.floor(at), Date.now() + 60_000)
      : Date.now();
  const stored = progress.books[id];
  if (stored && stored.updatedAt > when) return progress;
  const pos: BookPosition = {
    chapter: Math.max(0, Math.floor(chapter)),
    time: Math.max(0, Math.floor(time)),
    updatedAt: when,
  };
  const chapters: Record<string, number> = {
    ...progress.books[id]?.chapters,
    [pos.chapter]: pos.time,
  };
  if (typeof clear === "number") delete chapters[String(Math.floor(clear))];
  if (Object.keys(chapters).length) pos.chapters = chapters;
  progress.books[id] = pos;
  progress.last = { id, ...pos };
  await putObject(KEY, JSON.stringify(progress), "application/json");
  return progress;
}
