/**
 * The small decisions behind "Start listening", the confirm prompt, and what happens
 * when a chapter ends. Kept free of React and the browser so they can be tested.
 */

/** Chapters (0-based, inclusive) the listener chose to read. null means the whole book. */
export type ListenRange = { from: number; to: number } | null;

export const inRange = (range: ListenRange, index: number): boolean =>
  !range || (index >= range.from && index <= range.to);

/**
 * Where "Start listening" begins. A range the listener picked wins; otherwise it
 * resumes the saved spot; otherwise it starts at the first chapter of the range.
 */
export function startingPoint(opts: {
  rangeTouched: boolean;
  rangeFrom: number;
  saved?: { chapter: number; time: number } | null;
  chapterCount: number;
}): { chapter: number; time: number } {
  const clamp = (n: number) => Math.min(Math.max(0, n), Math.max(0, opts.chapterCount - 1));
  if (opts.rangeTouched) return { chapter: clamp(opts.rangeFrom), time: 0 };
  if (opts.saved && opts.saved.chapter >= 0 && opts.saved.chapter < opts.chapterCount) {
    return { chapter: opts.saved.chapter, time: opts.saved.time };
  }
  return { chapter: clamp(opts.rangeFrom), time: 0 };
}

/**
 * What to do when a chapter finishes playing:
 *  - "swap": the next chapter is already narrated, so roll straight into it (free);
 *  - "narrate": it isn't, but the listener asked for it (auto-narrate on, inside the range);
 *  - "stop": nothing more to play without spending money they didn't ask for.
 */
export function afterChapter(opts: {
  next: number;
  count: number;
  isReady: boolean;
  autoNext: boolean;
  range: ListenRange;
}): "swap" | "narrate" | "stop" {
  if (opts.next >= opts.count) return "stop";
  if (opts.isReady) return "swap";
  if (!opts.autoNext) return "stop";
  return inRange(opts.range, opts.next) ? "narrate" : "stop";
}

/** Narrate the next chapter in the background only inside the range and when auto-narrate is on. */
export const shouldPrefetch = (opts: {
  index: number;
  count: number;
  autoNext: boolean;
  range: ListenRange;
}): boolean => opts.index < opts.count && opts.autoNext && inRange(opts.range, opts.index);

/** Ask first when starting would narrate (and so spend money on) a chapter. */
export const needsConfirm = (opts: { isReady: boolean; confirmSetting: boolean }): boolean =>
  opts.confirmSetting && !opts.isReady;
