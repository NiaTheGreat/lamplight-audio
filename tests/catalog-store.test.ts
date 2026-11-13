import JSZip from "jszip";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-catalog-"));
process.env.CACHE_DIR = cacheDir;
delete process.env.BLOB_READ_WRITE_TOKEN;
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

const xhtml = (b: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${b}</body></html>`;

async function epub(title: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
  );
  zip.file(
    "content.opf",
    `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:description>A tiny summary.</dc:description></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`,
  );
  zip.file(
    "a.xhtml",
    xhtml("<h2>One</h2><p>The rain fell softly on the old house, and nobody came.</p>"),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("catalog storage", () => {
  it("adds, edits and removes items, keeping hand edits when details are read again", async () => {
    const { readCatalog, toItem, upsertItem, patchItem, removeItem, inCatalog, getFullSummary } =
      await import("@/lib/catalog/store");
    const book = {
      id: "aaaaaaaaaaaaaaaa",
      title: "T",
      author: "A",
      chapters: [{ index: 0, title: "One", text: "one two three" }],
    };
    const long = "x".repeat(600);
    await upsertItem(toItem(book, { source: "epub", summary: long, tags: ["a"] }, 10), long);
    let index = await readCatalog();
    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({ id: book.id, words: 3, chapters: 1, addedAt: 10 });
    expect(index.items[0].summary!.length).toBeLessThanOrEqual(400);
    expect(await getFullSummary(book.id)).toBe(long);
    expect(await inCatalog(book.id)).toBe(true);

    await patchItem(book.id, { userTags: [" my tag ", "my tag", "other"], completeOverride: true });
    // Upserting again (a re-upload) keeps the original date and the hand edits.
    await upsertItem(toItem(book, { source: "epub", tags: ["b"] }, 99));
    index = await readCatalog();
    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      addedAt: 10,
      userTags: ["my tag", "other"],
      completeOverride: true,
      tags: ["b"],
    });

    await patchItem(book.id, { userTags: [], completeOverride: null });
    index = await readCatalog();
    expect(index.items[0].userTags).toBeUndefined();
    expect(index.items[0].completeOverride).toBeUndefined();

    await removeItem(book.id);
    expect((await readCatalog()).items).toHaveLength(0);
    expect(await inCatalog(book.id)).toBe(false);
    expect(await patchItem("bbbbbbbbbbbbbbbb", { userTags: ["x"] })).toBeNull();
  });

  it("reads details for stored books from their kept EPUB, and from the text when there is none", async () => {
    const { refreshItems, readCatalog } = await import("@/lib/catalog/store");
    const { putObject } = await import("@/lib/storage/storage");
    const withEpub = "cccccccccccccccc";
    const without = "dddddddddddddddd";
    for (const id of [withEpub, without]) {
      await putObject(
        `books/${id}.json`,
        JSON.stringify({
          id,
          title: id === withEpub ? "Kept" : "Bare",
          chapters: [{ index: 0, title: "One", text: "alpha beta gamma delta" }],
        }),
        "application/json",
      );
    }
    await putObject(`epubs/${withEpub}.epub`, await epub("Kept"), "application/epub+zip");
    expect(await refreshItems([withEpub, without, "eeeeeeeeeeeeeeee"])).toBe(2);
    const items = (await readCatalog()).items;
    const kept = items.find((i) => i.id === withEpub)!;
    const bare = items.find((i) => i.id === without)!;
    expect(kept.summary).toBe("A tiny summary.");
    expect(kept.source).toBe("epub");
    expect(bare.summary).toBeUndefined();
    expect(bare.words).toBe(4);
  });
});

describe("reading record and shelf entry", () => {
  it("tracks the chapter, chapters finished, finished and marked unread", async () => {
    const { saveReading, getReading } = await import("@/lib/storage/reading");
    const id = "ffffffffffffffff";
    await saveReading({ id, chapter: 2, total: 5 });
    expect((await getReading())[id]).toMatchObject({ chapter: 2, done: [] });
    await saveReading({ id, chapter: 2, total: 5, done: true });
    await saveReading({ id, chapter: 2, total: 5, done: true });
    expect((await getReading())[id].done).toEqual([2]);
    expect((await getReading())[id].finished).toBeUndefined();
    await saveReading({ id, chapter: 4, total: 5, done: true });
    expect((await getReading())[id]).toMatchObject({ finished: true, done: [2, 4] });
    await saveReading({ id, finished: false });
    expect((await getReading())[id]).toMatchObject({ finished: false, done: [] });
    // Reading on after marking unread starts a new read.
    await saveReading({ id, chapter: 0, total: 5 });
    expect((await getReading())[id].finished).toBeUndefined();
  });

  it("puts a Browse-only fic on the shelf when it is narrated", async () => {
    const { markNarrated, ensureLibraryEntry } = await import("@/lib/storage/library");
    const { getObject, putObject } = await import("@/lib/storage/storage");
    const id = "1111111111111111";
    expect(await ensureLibraryEntry(id)).toBe(false);
    await putObject(
      `books/${id}.json`,
      JSON.stringify({
        id,
        title: "Only Browse",
        voice: "ballad",
        chapters: [
          { index: 0, title: "One", text: "abc" },
          { index: 1, title: "Two", text: "defg" },
        ],
      }),
      "application/json",
    );
    expect(await getObject(`library/${id}.json`)).toBeNull();
    await markNarrated(id, 1);
    const entry = JSON.parse((await getObject(`library/${id}.json`))!.toString("utf8"));
    expect(entry).toMatchObject({
      title: "Only Browse",
      chapterCount: 2,
      narrated: [1],
      chars: [3, 4],
    });
  });
});
