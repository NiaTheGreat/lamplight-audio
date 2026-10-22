import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyPronunciations, sanitizeLines } from "@/lib/pronunciation";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-pron-"));
process.env.CACHE_DIR = cacheDir;
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe("applying pronunciations", () => {
  it("leaves text untouched with no lines (so existing cache keys don't change)", () => {
    const t = "Hermione smiled.";
    expect(applyPronunciations(t, [])).toBe(t);
    expect(applyPronunciations(t, undefined)).toBe(t);
  });
  it("replaces whole words in any case, not parts of words", () => {
    const lines = [{ from: "Sirius", to: "SEER-ee-us" }];
    expect(applyPronunciations("Sirius, sirius and Siriusly.", lines)).toBe("SEER-ee-us, SEER-ee-us and Siriusly.");
  });
  it("handles regex characters, multi-word lines and never re-replaces", () => {
    const lines = [
      { from: "Mr. Black", to: "Mister Black" },
      { from: "Black", to: "Black Black" },
    ];
    expect(applyPronunciations("Mr. Black met Black.", lines)).toBe("Mister Black met Black Black.");
  });
  it("cleans up submitted lines", () => {
    expect(sanitizeLines([{ from: " A ", to: "ay" }, { from: "a", to: "dup" }, { from: "", to: "x" }, 5])).toEqual([
      { from: "A", to: "ay" },
    ]);
    expect(sanitizeLines("nope")).toEqual([]);
  });
});

describe("saving pronunciations", () => {
  const ID = "aaaa111122223333";
  async function seed() {
    const { putObject } = await import("@/lib/storage");
    const chapters = [
      { index: 0, title: "One", text: "Sirius ran." },
      { index: 1, title: "Two", text: "Sirius sat." },
      { index: 2, title: "Three", text: "Nobody here." },
    ];
    await putObject(`books/${ID}.json`, JSON.stringify({ id: ID, title: "T", chapters }), "application/json");
    await putObject(
      `library/${ID}.json`,
      JSON.stringify({ id: ID, title: "T", chapterCount: 3, addedAt: 1, narrated: [0] }),
      "application/json",
    );
  }

  it("keeps narrated chapters on their old lines until they are re-narrated", async () => {
    const { savePronunciations, renarrate, getPronunciations } = await import("@/lib/pronunciation-store");
    const { getObject } = await import("@/lib/storage");
    const { spokenText } = await import("@/lib/pronunciation");
    await seed();

    const saved = await savePronunciations(ID, [{ from: "Sirius", to: "SEER-ee-us" }]);
    // Chapter 0 is narrated and would change: it stays as it was, and is offered for re-narration.
    expect(saved.stale.map((c) => c.index)).toEqual([0]);
    const book = JSON.parse((await getObject(`books/${ID}.json`))!.toString("utf8"));
    expect(spokenText(book, 0, book.chapters[0].text)).toBe("Sirius ran.");
    expect(spokenText(book, 1, book.chapters[1].text)).toBe("SEER-ee-us sat.");

    const again = await renarrate(ID, undefined);
    expect(again.renarrate).toEqual([0]);
    expect(again.stale).toEqual([]);
    const entry = JSON.parse((await getObject(`library/${ID}.json`))!.toString("utf8"));
    expect(entry.narrated).toEqual([]);
    const book2 = JSON.parse((await getObject(`books/${ID}.json`))!.toString("utf8"));
    expect(spokenText(book2, 0, book2.chapters[0].text)).toBe("SEER-ee-us ran.");
    expect((await getPronunciations(ID)).lines).toHaveLength(1);
  });

  it("refuses to change the list while narration is running", async () => {
    const { savePronunciations } = await import("@/lib/pronunciation-store");
    const { startJob } = await import("@/lib/narration");
    await seed();
    await startJob(ID, 3);
    await expect(savePronunciations(ID, [])).rejects.toThrow(/running/);
  });
});
