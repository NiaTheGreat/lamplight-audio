import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyPronunciations, effectiveLines, sanitizeLines } from "@/lib/pronunciation";

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

describe("named lists", () => {
  it("own lines win over the copied list", () => {
    const lines = effectiveLines({
      pronList: { id: "x", name: "HP", lines: [{ from: "Sirius", to: "list" }, { from: "Harry", to: "h" }] },
      pronunciations: [{ from: "sirius", to: "own" }],
    });
    expect(applyPronunciations("Sirius and Harry", lines)).toBe("own and h");
  });

  it("saves lists, copies the automatic one into new fics, and updates a copy on request", async () => {
    const { saveLists, listForUpload } = await import("@/lib/pronlists");
    const { updateFromList, getPronunciations } = await import("@/lib/pronunciation-store");
    const { putObject } = await import("@/lib/storage");

    const saved = await saveLists({ lists: [{ name: "HP", lines: [{ from: "Sirius", to: "SEER-ee-us" }] }], auto: "bogus" });
    expect(saved.auto).toBeUndefined(); // unknown id ignored
    const id = saved.lists[0].id;
    const withAuto = await saveLists({ lists: saved.lists, auto: id });
    expect((await listForUpload(undefined))?.name).toBe("HP");
    expect(await listForUpload("none")).toBeUndefined();
    expect((await listForUpload(id))?.id).toBe(id);

    const bookId = "bbbb111122223333";
    await putObject(`books/${bookId}.json`, JSON.stringify({ id: bookId, title: "T", chapters: [{ index: 0, title: "A", text: "Sirius ran." }], pronList: { id, name: "HP", lines: [] } }), "application/json");
    const got = await updateFromList(bookId, withAuto.lists[0]);
    expect(got.list?.lines).toHaveLength(1);
    expect((await getPronunciations(bookId)).list?.name).toBe("HP");
  });
});

describe("re-reading one chapter", () => {
  it("removes that chapter's audio and un-narrates only it", async () => {
    const { putObject, hasObject, getObject } = await import("@/lib/storage");
    const { rereadChapter } = await import("@/lib/reread");
    const { audioKey } = await import("@/lib/tts");
    const { splitForTts } = await import("@/lib/text");
    const id = "cccc111122223333";
    const chapters = [0, 1].map((i) => ({ index: i, title: `C${i}`, text: `Chapter ${i} words here.` }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "T", voice: "ballad", chapters }), "application/json");
    await putObject(`library/${id}.json`, JSON.stringify({ id, title: "T", chapterCount: 2, addedAt: 1, narrated: [0, 1] }), "application/json");
    const keys = chapters.map((c) => [audioKey(c.text, "ballad"), ...splitForTts(c.text).map((t) => audioKey(t, "ballad"))]);
    for (const k of keys.flat()) await putObject(k, Buffer.alloc(10), "audio/mpeg");

    await rereadChapter(id, 0);
    expect(await hasObject(keys[0][0])).toBe(false);
    expect(await hasObject(keys[1][0])).toBe(true);
    const entry = JSON.parse((await getObject(`library/${id}.json`))!.toString("utf8"));
    expect(entry.narrated).toEqual([1]);
    await expect(rereadChapter(id, 0)).rejects.toThrow(/isn't narrated/);
  });
});

describe("a crashed worker's job", () => {
  it("does not block re-reading once it has gone quiet", async () => {
    const { putObject } = await import("@/lib/storage");
    const { rereadChapter } = await import("@/lib/reread");
    const id = "dddd111122223333";
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "T", voice: "ballad", chapters: [{ index: 0, title: "A", text: "Words." }] }), "application/json");
    await putObject(`library/${id}.json`, JSON.stringify({ id, title: "T", chapterCount: 1, addedAt: 1, narrated: [0] }), "application/json");
    const job = { status: "running", chapter: 0, total: 1, startedAt: 1, updatedAt: Date.now(), leaseUntil: 0 };
    await putObject(`jobs/${id}.json`, JSON.stringify(job), "application/json");
    await expect(rereadChapter(id, 0)).rejects.toThrow(/running/); // just saved progress: busy
    await putObject(`jobs/${id}.json`, JSON.stringify({ ...job, updatedAt: Date.now() - 9 * 60_000 }), "application/json");
    await expect(rereadChapter(id, 0)).resolves.toMatchObject({ chapter: 0 }); // quiet for 9 minutes: dead
  });
});

describe("re-reading with another voice or list", () => {
  const id = "eeee111122223333";
  async function seed() {
    const { putObject } = await import("@/lib/storage");
    const chapters = [0, 1, 2].map((i) => ({ index: i, title: `C${i}`, text: `Sirius chapter ${i} words.` }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "T", voice: "ballad", chapters }), "application/json");
    await putObject(`library/${id}.json`, JSON.stringify({ id, title: "T", chapterCount: 3, addedAt: 1, narrated: [0, 1, 2] }), "application/json");
  }
  const read = async (key: string) => JSON.parse((await (await import("@/lib/storage")).getObject(key))!.toString("utf8"));

  it("a voice for one chapter leaves the fic's voice and other chapters alone", async () => {
    const { rereadChapter } = await import("@/lib/reread");
    const { voiceFor } = await import("@/lib/chaptervoice");
    await seed();
    await rereadChapter(id, 1, { voice: "deepinfra:kokoro:af_bella" });
    const book = await read(`books/${id}.json`);
    expect(book.voice).toBe("ballad");
    expect(voiceFor(book, 1)).toBe("deepinfra:kokoro:af_bella");
    expect(voiceFor(book, 0)).toBe("ballad");
    expect((await read(`library/${id}.json`)).narrated).toEqual([0, 2]);
  });

  it("a voice for the whole fic pins the chapters already narrated to their voice", async () => {
    const { rereadChapter } = await import("@/lib/reread");
    const { voiceFor } = await import("@/lib/chaptervoice");
    await seed();
    await rereadChapter(id, 1, { voice: "deepinfra:kokoro:af_bella", voiceForBook: true });
    const book = await read(`books/${id}.json`);
    expect(book.voice).toBe("deepinfra:kokoro:af_bella");
    expect(voiceFor(book, 0)).toBe("ballad");
    expect(voiceFor(book, 2)).toBe("ballad");
    expect(voiceFor(book, 1)).toBe("deepinfra:kokoro:af_bella");
    expect((await read(`library/${id}.json`)).voice).toBe("deepinfra:kokoro:af_bella");
  });

  it("another list applies to the chapter but not to the others narrated", async () => {
    const { rereadChapter } = await import("@/lib/reread");
    const { saveLists } = await import("@/lib/pronlists");
    const { spokenText } = await import("@/lib/pronunciation");
    await seed();
    const { lists } = await saveLists({ lists: [{ name: "L", lines: [{ from: "Sirius", to: "SEER-ee-us" }] }] });
    await rereadChapter(id, 0, { listId: lists[0].id });
    const book = await read(`books/${id}.json`);
    expect(spokenText(book, 0, book.chapters[0].text)).toContain("SEER-ee-us");
    expect(spokenText(book, 1, book.chapters[1].text)).toContain("Sirius");
    await expect(rereadChapter(id, 1, { listId: "nope" })).rejects.toThrow(/no longer exists/);
    await expect(rereadChapter(id, 2, { voice: "not-a-voice" })).rejects.toThrow(/Unknown narrator/);
  });
});

describe("re-reading several chapters at once", () => {
  const id = "ffff111122223333";
  it("applies one voice and list change to all the chosen chapters and leaves the rest", async () => {
    const { putObject, getObject } = await import("@/lib/storage");
    const { rereadChapters } = await import("@/lib/reread");
    const { voiceFor } = await import("@/lib/chaptervoice");
    const chapters = [0, 1, 2, 3].map((i) => ({ index: i, title: `M${i}`, text: `Regina chapter ${i} words.` }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "T", voice: "ballad", chapters }), "application/json");
    await putObject(`library/${id}.json`, JSON.stringify({ id, title: "T", chapterCount: 4, addedAt: 1, narrated: [0, 1, 2, 3] }), "application/json");

    const r = await rereadChapters(id, [2, 0, 2], { voice: "deepinfra:kokoro:af_bella" });
    expect(r.chapters).toEqual([0, 2]);
    const book = JSON.parse((await getObject(`books/${id}.json`))!.toString("utf8"));
    expect([0, 1, 2, 3].map((i) => voiceFor(book, i))).toEqual([
      "deepinfra:kokoro:af_bella", "ballad", "deepinfra:kokoro:af_bella", "ballad",
    ]);
    expect(JSON.parse((await getObject(`library/${id}.json`))!.toString("utf8")).narrated).toEqual([1, 3]);
    await expect(rereadChapters(id, [0], {})).rejects.toThrow(/isn't narrated/); // not narrated any more
    await expect(rereadChapters(id, [], {})).rejects.toThrow(/Which chapters/);
    await expect(rereadChapters(id, [1, 0], {})).rejects.toThrow(/aren't all narrated/);
  });
});
