import type { ReadingEntry } from "./meta";

export type ReadState = {
  kind: "unread" | "reading" | "finished";
  /** The chapter to continue from (0-based); 0 for unread. */
  chapter: number;
  total: number;
  /** When it was last opened, 0 if never. */
  at: number;
};

/**
 * Where a fic stands, from the reading record and the listening position (`progress.json`):
 * the later of the two says which chapter to continue from. Marking unread hides older activity.
 */
export function readState(
  entry: ReadingEntry | undefined,
  listen: { chapter: number; updatedAt: number } | undefined,
  total: number,
): ReadState {
  if (entry?.finished === true)
    return { kind: "finished", chapter: Math.max(0, total - 1), total, at: entry.updatedAt };
  const markedUnread = entry?.finished === false;
  const listenCounts = listen && (!markedUnread || listen.updatedAt > (entry?.updatedAt ?? 0));
  const readCounts = entry && !markedUnread;
  const candidates: { chapter: number; at: number }[] = [];
  if (readCounts) candidates.push({ chapter: entry.chapter, at: entry.updatedAt });
  if (listenCounts && listen) candidates.push({ chapter: listen.chapter, at: listen.updatedAt });
  if (candidates.length === 0) return { kind: "unread", chapter: 0, total, at: 0 };
  const latest = candidates.reduce((a, b) => (b.at >= a.at ? b : a));
  const chapter = Math.min(Math.max(0, latest.chapter), Math.max(0, total - 1));
  return { kind: "reading", chapter, total, at: latest.at };
}
