import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "@/lib/epub";

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

async function buildEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Fic</dc:title><dc:creator>Some Author</dc:creator></metadata>
      <manifest>
        <item id="pre" href="preface.xhtml" media-type="application/xhtml+xml"/>
        <item id="c1" href="chapter_1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="chapter_2.xhtml" media-type="application/xhtml+xml"/>
        <item id="post" href="afterword.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="pre"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="post"/></spine>
    </package>`,
  );
  zip.file(
    "OEBPS/preface.xhtml",
    xhtml(
      `<div class="meta group"><h1>Test Fic</h1><div id="summary"><h3>Summary</h3><blockquote class="userstuff"><p>WORKSUMMARY should never be read aloud.</p></blockquote></div></div>`,
    ),
  );
  zip.file(
    "OEBPS/chapter_1.xhtml",
    xhtml(
      `<div class="meta group"><h2 class="heading">Chapter 1: The Start</h2>
        <div id="summary"><h3 class="heading">Chapter Summary</h3><blockquote class="userstuff"><p>CHAPSUMMARY skip me.</p></blockquote></div>
        <div id="notes"><h3 class="heading">Chapter Notes</h3><blockquote class="userstuff"><p>AUTHORNOTE skip me.</p></blockquote></div>
      </div>
      <div class="userstuff"><p>The rain fell softly on the old house.</p><p>She listened, and
        did not move.</p><p>* * *</p><p>Morning came slowly.</p></div>
      <div class="meta"><div id="endnotes"><h3 class="heading">Chapter End Notes</h3><blockquote class="userstuff"><p>ENDNOTE skip me.</p></blockquote></div></div>`,
    ),
  );
  zip.file(
    "OEBPS/chapter_2.xhtml",
    xhtml(
      `<h2>Chapter 2</h2><h3>Notes</h3><blockquote><p>GENERICNOTE skip me.</p></blockquote><p>The second chapter has plenty of story in it.</p>`,
    ),
  );
  zip.file("OEBPS/afterword.xhtml", xhtml(`<p>AFTERWORD skip me, this is long enough to count.</p>`));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("parseEpub", () => {
  it("reads metadata and keeps only story chapters", async () => {
    const book = await parseEpub(await buildEpub());
    expect(book.title).toBe("Test Fic");
    expect(book.author).toBe("Some Author");
    expect(book.chapters).toHaveLength(2);
    expect(book.id).toMatch(/^[a-f0-9]{16}$/);
  });

  it("strips summaries and author's notes", async () => {
    const book = await parseEpub(await buildEpub());
    const all = book.chapters.map((c) => c.text).join("\n");
    for (const banned of ["WORKSUMMARY", "CHAPSUMMARY", "AUTHORNOTE", "ENDNOTE", "GENERICNOTE", "AFTERWORD"]) {
      expect(all).not.toContain(banned);
    }
    expect(book.chapters[0].text).toContain("The rain fell softly on the old house.");
    expect(book.chapters[0].text).toContain("She listened, and did not move.");
    expect(book.chapters[1].text).toContain("The second chapter has plenty of story in it.");
  });

  it("announces the chapter title and drops scene-break symbols", async () => {
    const book = await parseEpub(await buildEpub());
    expect(book.chapters[0].title).toBe("Chapter 1: The Start");
    expect(book.chapters[0].text.startsWith("Chapter 1: The Start.")).toBe(true);
    expect(book.chapters[0].text).not.toContain("* * *");
  });

  it("keeps notes when skipNotes is off", async () => {
    const book = await parseEpub(await buildEpub(), { skipNotes: false });
    const all = book.chapters.map((c) => c.text).join("\n");
    expect(all).toContain("AUTHORNOTE");
    expect(all).toContain("ENDNOTE");
  });

  it("rejects things that aren't EPUBs", async () => {
    await expect(parseEpub(Buffer.from("not a zip"))).rejects.toThrow(/valid EPUB/);
  });
});
