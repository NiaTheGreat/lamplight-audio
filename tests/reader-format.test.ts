import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { parseEpub } from "@/lib/epub";
import { chapterText } from "@/lib/reader/format";

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

async function epub(chapters: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fmt</dc:title></metadata>
      <manifest>${chapters.map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest>
      <spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine>
    </package>`,
  );
  chapters.forEach((c, i) => zip.file(`OEBPS/c${i}.xhtml`, xhtml(c)));
  return zip.generateAsync({ type: "nodebuffer" });
}

const CH1 = `<h2>Chapter 1: Start</h2>
  <p>She said, <em>never</em> again. He was <strong>very</strong> sure.</p>
  <p>Second line<br/>after a break, with an <em> odd space </em>here.</p>
  <hr/>
  <p>* * *</p>
  <blockquote><p>A letter, <i>sealed</i> in wax.</p><p>More of the letter.</p></blockquote>
  <p>After the letter. It was long enough to count as a real paragraph of text.</p>`;
const CH2 = `<h2>Chapter 2</h2><p>Plain words only here, nothing fancy, but enough to be a chapter.</p>`;

describe("reader copy of a chapter", () => {
  it("never changes the narrated text", async () => {
    const buf = await epub([CH1, CH2]);
    const plain = await parseEpub(buf);
    const fmt = await parseEpub(buf, { format: true });
    expect(fmt.id).toBe(plain.id);
    expect(fmt.chapters.map((c) => ({ ...c, paras: undefined }))).toEqual(
      plain.chapters.map((c) => ({ ...c, paras: undefined })),
    );
  });

  it("reads exactly as the narrated text, with italics, bold, quotes and breaks", async () => {
    const book = await parseEpub(await epub([CH1, CH2]), { format: true });
    for (const c of book.chapters) expect(chapterText(c.paras!)).toBe(c.text);
    const paras = book.chapters[0].paras!;
    expect(paras[0].runs).toEqual([{ t: "Chapter 1: Start" }]);
    const first = paras[1].runs;
    expect(first.find((r) => r.t === "never")?.i).toBe(true);
    expect(first.find((r) => r.t === "very")?.b).toBe(true);
    expect(paras.some((p) => p.kind === "break")).toBe(true);
    const quotes = paras.filter((p) => p.kind === "quote");
    expect(quotes).toHaveLength(2);
    expect(quotes[0].runs.find((r) => r.t === "sealed")?.i).toBe(true);
  });

  it("is not added unless asked for", async () => {
    const book = await parseEpub(await epub([CH1, CH2]));
    expect(book.chapters[0].paras).toBeUndefined();
  });
});
