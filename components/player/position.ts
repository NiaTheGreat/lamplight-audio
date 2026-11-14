import type { Position } from "./types";

/** Where the phone keeps its own copy of a book's listening place, in case the server's is behind. */
export const POS_KEY = (bookId: string) => `abg:pos:${bookId}`;

/**
 * Two copies of one book's listening place (the server's and this device's): the newer wins, and
 * the part-listened chapter spots of both are kept (the newer copy's value for a chapter wins).
 */
export function newerPosition(
  a: Position | null | undefined,
  b: Position | null | undefined,
): Position | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const [older, newer] = a.updatedAt > b.updatedAt ? [b, a] : [a, b];
  const chapters = { ...older.chapters, ...newer.chapters };
  return { ...newer, ...(Object.keys(chapters).length ? { chapters } : {}) };
}
