import { describe, expect, it } from "vitest";
import { newerPosition } from "@/components/player/position";

describe("newerPosition", () => {
  it("takes whichever copy is missing", () => {
    const a = { chapter: 1, time: 5, updatedAt: 10 };
    expect(newerPosition(a, null)).toBe(a);
    expect(newerPosition(undefined, a)).toBe(a);
    expect(newerPosition(null, undefined)).toBeNull();
  });

  it("takes the newer copy and keeps the chapter spots of both", () => {
    const server = { chapter: 1, time: 5, updatedAt: 10, chapters: { "0": 40, "1": 5 } };
    const local = { chapter: 2, time: 9, updatedAt: 20, chapters: { "1": 8, "2": 9 } };
    expect(newerPosition(server, local)).toEqual({
      chapter: 2,
      time: 9,
      updatedAt: 20,
      chapters: { "0": 40, "1": 8, "2": 9 },
    });
    expect(newerPosition(local, server)?.chapter).toBe(2);
  });
});
