import { describe, expect, it } from "vitest";
import { afterChapter, inRange, needsConfirm, shouldPrefetch, startingPoint } from "@/lib/listening";

describe("Start listening", () => {
  it("begins at the first chapter of a range the listener picked, not chapter 1", () => {
    // "chapters 7 to 13" is from=6 (0-based): it must not start at chapter 0
    expect(startingPoint({ rangeTouched: true, rangeFrom: 6, saved: null, chapterCount: 22 })).toEqual({ chapter: 6, time: 0 });
  });

  it("a picked range wins over a saved spot elsewhere", () => {
    expect(
      startingPoint({ rangeTouched: true, rangeFrom: 6, saved: { chapter: 2, time: 90 }, chapterCount: 22 }),
    ).toEqual({ chapter: 6, time: 0 });
  });

  it("without a picked range it resumes the saved spot, else the default range start", () => {
    expect(
      startingPoint({ rangeTouched: false, rangeFrom: 3, saved: { chapter: 9, time: 120 }, chapterCount: 22 }),
    ).toEqual({ chapter: 9, time: 120 });
    expect(startingPoint({ rangeTouched: false, rangeFrom: 3, saved: null, chapterCount: 22 })).toEqual({ chapter: 3, time: 0 });
  });

  it("ignores a saved spot that no longer exists and keeps the start inside the book", () => {
    expect(
      startingPoint({ rangeTouched: false, rangeFrom: 0, saved: { chapter: 99, time: 5 }, chapterCount: 5 }),
    ).toEqual({ chapter: 0, time: 0 });
    expect(startingPoint({ rangeTouched: true, rangeFrom: 40, saved: null, chapterCount: 5 })).toEqual({ chapter: 4, time: 0 });
  });
});

describe("range-limited narrating", () => {
  const range = { from: 6, to: 12 };

  it("knows what is inside the range", () => {
    expect(inRange(range, 6)).toBe(true);
    expect(inRange(range, 12)).toBe(true);
    expect(inRange(range, 13)).toBe(false);
    expect(inRange(range, 5)).toBe(false);
    expect(inRange(null, 99)).toBe(true);
  });

  it("only prefetches inside the range, and only when auto-narrate is on", () => {
    expect(shouldPrefetch({ index: 12, count: 22, autoNext: true, range })).toBe(true);
    expect(shouldPrefetch({ index: 13, count: 22, autoNext: true, range })).toBe(false); // would spend money past the range
    expect(shouldPrefetch({ index: 8, count: 22, autoNext: false, range })).toBe(false);
    expect(shouldPrefetch({ index: 22, count: 22, autoNext: true, range: null })).toBe(false);
  });

  it("at the end of a chapter: swap into narrated chapters, narrate only what was asked for, else stop", () => {
    // next chapter already narrated: always free to continue, even past the range
    expect(afterChapter({ next: 13, count: 22, isReady: true, autoNext: false, range })).toBe("swap");
    // not narrated, inside the range, auto-narrate on
    expect(afterChapter({ next: 9, count: 22, isReady: false, autoNext: true, range })).toBe("narrate");
    // not narrated, past the end of the range: stop instead of spending
    expect(afterChapter({ next: 13, count: 22, isReady: false, autoNext: true, range })).toBe("stop");
    // auto-narrate off
    expect(afterChapter({ next: 9, count: 22, isReady: false, autoNext: false, range })).toBe("stop");
    // end of the book
    expect(afterChapter({ next: 22, count: 22, isReady: true, autoNext: true, range: null })).toBe("stop");
  });
});

describe("confirm before narrating", () => {
  it("asks only when a chapter would be narrated and the setting is on", () => {
    expect(needsConfirm({ isReady: false, confirmSetting: true })).toBe(true);
    expect(needsConfirm({ isReady: true, confirmSetting: true })).toBe(false); // free to play
    expect(needsConfirm({ isReady: false, confirmSetting: false })).toBe(false);
  });
});
