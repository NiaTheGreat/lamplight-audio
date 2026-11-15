import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("progress: a spot per chapter", () => {
  beforeEach(() => {
    process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), "progress-"));
  });

  it("remembers each chapter left part-way and forgets one that was finished", async () => {
    const { savePosition } = await import("@/lib/storage/progress");
    await savePosition("b1", 1, 120);
    const second = await savePosition("b1", 3, 15);
    expect(second.books.b1).toMatchObject({ chapter: 3, time: 15, chapters: { 1: 120, 3: 15 } });
    const third = await savePosition("b1", 3, 600, 1);
    expect(third.books.b1.chapters).toEqual({ 3: 600 });
  });

  it("ignores a save that was made earlier than the one already stored", async () => {
    const { savePosition } = await import("@/lib/storage/progress");
    await savePosition("b2", 4, 300, undefined, 2000);
    const late = await savePosition("b2", 2, 10, undefined, 1000);
    expect(late.books.b2).toMatchObject({ chapter: 4, time: 300, updatedAt: 2000 });
    const newer = await savePosition("b2", 5, 7, undefined, 3000);
    expect(newer.books.b2).toMatchObject({ chapter: 5, time: 7, updatedAt: 3000 });
  });
});
