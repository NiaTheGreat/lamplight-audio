export type JobInfo = {
  status: "running" | "paused" | "done" | "cancelled" | "error";
  chapter: number;
  total: number;
  from?: number;
  to?: number;
  updatedAt: number;
  error?: string;
};
// A running job that hasn't saved progress for this long has probably lost its worker.
export const STALE_MS = 8 * 60 * 1000;

export type Position = {
  chapter: number;
  time: number;
  updatedAt: number;
  /** Seconds listened in each chapter left part-way, by chapter index. */
  chapters?: Record<string, number>;
};
export type Progress = {
  last: ({ id: string } & Position) | null;
  books: Record<string, Position>;
};
export type ChapterState = "ready" | "reading" | "waiting" | "playing" | "failed";
export type Sleep =
  { kind: "off" } | { kind: "chapter" } | { kind: "minutes"; endsAt: number; minutes: number };

/** A chapter the listener asked to start that would be narrated (and so cost money), waiting for a yes. */
export type PendingNarration = {
  bookId: string;
  index: number;
  startAt: number;
  fresh: boolean;
  /** Narrate it in the background without leaving the chapter that is playing. */
  ahead?: boolean;
  title: string;
  chars: number;
  costUsd: number;
  narrator: string | undefined;
};

export type OpenOptions = {
  /** Start here instead of the saved spot. */
  chapter?: number;
  time?: number;
  /** The chapters chosen to be read; narration and auto-advance stay inside it. */
  range?: { from: number; to: number } | null;
};
