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
});
