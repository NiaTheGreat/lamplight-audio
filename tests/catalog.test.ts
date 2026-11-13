import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "@/lib/epub";
import { parseAo3Preface } from "@/lib/catalog/extract";

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

const STORY = "<p>The rain fell softly on the old house, and nobody came to the door.</p>";

// AO3's work-info block, as in a "Download > EPUB" preface (made-up work).
const AO3_BLOCK = `<div class="meta group"><h1>The Long Way</h1>
  <p>Posted originally on the <a href="https://archiveofourown.org/works/4001737">Archive of Our Own</a>.</p>
  <div class="byline">by <a rel="author" href="/users/x">quillandember</a></div>
  <dl class="tags">
    <dt>Rating:</dt><dd><a class="tag" href="#">Mature</a></dd>
    <dt>Archive Warning:</dt><dd><a class="tag" href="#">No Archive Warnings Apply</a></dd>
    <dt>Category:</dt><dd><a class="tag" href="#">F/M</a>, <a class="tag" href="#">Gen</a></dd>
    <dt>Fandom:</dt><dd><a class="tag" href="#">Harbor Lights (TV)</a></dd>
    <dt>Relationship:</dt><dd><a class="tag" href="#">Imogen Vale/Tomas Reyes</a></dd>
    <dt>Characters:</dt><dd><a class="tag" href="#">Imogen Vale</a>, <a class="tag" href="#">Tomas Reyes</a></dd>
    <dt>Additional Tags:</dt><dd><a class="tag" href="#">Found Family</a>, <a class="tag" href="#">Slow Burn</a></dd>
    <dt>Language:</dt><dd>English</dd>
    <dt>Series:</dt><dd>Part 2 of <a href="#">Lanterns</a></dd>
    <dt>Stats:</dt><dd>Published: 2020-01-05 Completed: 2021-03-02 Words: 142,380 Chapters: 31/31</dd>
  </dl></div>
  <p>Summary</p><blockquote class="userstuff"><p>First paragraph of the summary.</p><p>Second paragraph.</p></blockquote>`;

async function epub(opts: {
  files: Record<string, string>;
  spine: string[];
  metadata?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "META-INF/container.xml",
    `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
  );
  const ids = opts.spine.map((f, i) => ({ f, id: `i${i}` }));
  zip.file(
    "content.opf",
    `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${opts.metadata ?? "<dc:title>T</dc:title>"}</metadata><manifest>${ids.map((x) => `<item id="${x.id}" href="${x.f}" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${ids.map((x) => `<itemref idref="${x.id}"/>`).join("")}</spine></package>`,
  );
  for (const [name, body] of Object.entries(opts.files)) zip.file(name, xhtml(body));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseAo3Preface", () => {
  it("reads the work-info block and summary", () => {
    const m = parseAo3Preface(xhtml(AO3_BLOCK))!;
    expect(m.rating).toBe("Mature");
    expect(m.workId).toBe("4001737");
    expect(m.warnings).toEqual(["No Archive Warnings Apply"]);
    expect(m.category).toEqual(["F/M", "Gen"]);
    expect(m.fandoms).toEqual(["Harbor Lights (TV)"]);
    expect(m.relationships).toEqual(["Imogen Vale/Tomas Reyes"]);
    expect(m.characters).toEqual(["Imogen Vale", "Tomas Reyes"]);
    expect(m.tags).toEqual(["Found Family", "Slow Burn"]);
    expect(m.language).toBe("English");
    expect(m.series).toBe("Part 2 of Lanterns");
    expect(m.published).toBe("2020-01-05");
    expect(m.updated).toBe("2021-03-02");
    expect(m.words).toBe(142380);
    expect(m.chaptersDone).toBe(31);
    expect(m.chaptersTotal).toBe(31);
    expect(m.complete).toBe(true);
    expect(m.summary).toBe("First paragraph of the summary.\n\nSecond paragraph.");
  });

  it("treats 3/? and 3/10 as unfinished", () => {
    for (const chapters of ["3/?", "3/10"]) {
      const html = xhtml(
        `<dl class="tags"><dt>Stats:</dt><dd>Published: 2020-01-05 Updated: 2020-02-01 Words: 900 Chapters: ${chapters}</dd></dl>`,
      );
      const m = parseAo3Preface(html)!;
      expect(m.complete).toBe(false);
      expect(m.updated).toBe("2020-02-01");
    }
    expect(
      parseAo3Preface(xhtml(`<dl class="tags"><dt>Stats:</dt><dd>Chapters: 3/?</dd></dl>`))!
        .chaptersTotal,
    ).toBeUndefined();
  });

  it("returns null for a page without a work-info block", () => {
    expect(parseAo3Preface(xhtml("<p>Just story.</p>"))).toBeNull();
  });
});

describe("parseEpub with meta", () => {
  it("reads an AO3 preface even though narration skips it", async () => {
    const buf = await epub({
      spine: ["preface.xhtml", "c1.xhtml"],
      files: { "preface.xhtml": AO3_BLOCK, "c1.xhtml": `<h2>Chapter 1</h2>${STORY}` },
    });
    const book = await parseEpub(buf, { meta: true });
    expect(book.meta?.source).toBe("ao3-preface");
    expect(book.meta?.rating).toBe("Mature");
    expect(book.meta?.words).toBe(142380);
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].text).not.toContain("First paragraph of the summary");
  });

  it("finds the block in a Calibre-split file with a generic name", async () => {
    const buf = await epub({
      spine: ["s_000.xhtml", "s_001.xhtml"],
      files: {
        "s_000.xhtml": `<div id="preface">${AO3_BLOCK}</div>`,
        "s_001.xhtml": `<div id="chapters"><h2>Chapter 1</h2>${STORY}</div>`,
      },
    });
    const book = await parseEpub(buf, { meta: true });
    expect(book.meta?.fandoms).toEqual(["Harbor Lights (TV)"]);
    expect(book.chapters).toHaveLength(1);
  });

  it("uses the package file when that is all there is (exports with no work-info block)", async () => {
    const buf = await epub({
      spine: ["cover.xhtml", "chapter_001.xhtml", "chapter_002.xhtml"],
      files: {
        "cover.xhtml": `<div class="cover"><h1>Movie</h1><p class="cover-author">by Someone</p></div>`,
        "chapter_001.xhtml": `<h2>Chapter 1</h2>${STORY}`,
        "chapter_002.xhtml": `<h2>Chapter 2</h2>${STORY}`,
      },
      metadata: `<dc:identifier id="uid">urn:ao3:10374027</dc:identifier><dc:title>Movie</dc:title><dc:creator>Someone</dc:creator><dc:language>en</dc:language><dc:description>A short &amp; made-up summary.</dc:description><dc:subject>Harbor Lights (TV)</dc:subject>`,
    });
    const book = await parseEpub(buf, { meta: true });
    expect(book.meta).toMatchObject({
      source: "epub",
      summary: "A short & made-up summary.",
      fandoms: ["Harbor Lights (TV)"],
      language: "English",
      workId: "10374027",
      chaptersDone: 2,
    });
    expect(book.meta?.words).toBeGreaterThan(20);
    // Nothing in such a file says whether the work is finished or how it is rated.
    expect(book.meta?.complete).toBeUndefined();
    expect(book.meta?.rating).toBeUndefined();
  });

  it("keeps non-AO3 subjects as tags", async () => {
    const buf = await epub({
      spine: ["c1.xhtml"],
      files: { "c1.xhtml": `<h2>One</h2>${STORY}` },
      metadata: `<dc:title>Novel</dc:title><dc:subject>Mystery</dc:subject><dc:subject>Cozy</dc:subject>`,
    });
    const book = await parseEpub(buf, { meta: true });
    expect(book.meta?.tags).toEqual(["Mystery", "Cozy"]);
    expect(book.meta?.fandoms).toBeUndefined();
  });

  it("never changes the narrated text or the book id", async () => {
    const buf = await epub({
      spine: ["preface.xhtml", "c1.xhtml"],
      files: { "preface.xhtml": AO3_BLOCK, "c1.xhtml": `<h2>Chapter 1</h2>${STORY}` },
    });
    const plain = await parseEpub(buf);
    const withMeta = await parseEpub(buf, { meta: true });
    expect(withMeta.id).toBe(plain.id);
    expect(withMeta.chapters).toEqual(plain.chapters);
    expect(plain.meta).toBeUndefined();
  });
});
