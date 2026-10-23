import JSZip from "jszip";

const xhtml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`;

/** A small three-chapter EPUB, built in memory. */
export async function buildEpub(title = "E2E Fic"): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>E2E Author</dc:creator></metadata>
      <manifest>
        <item id="c1" href="chapter_1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="chapter_2.xhtml" media-type="application/xhtml+xml"/>
        <item id="c3" href="chapter_3.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine>
    </package>`,
  );
  const paragraph = "The rain fell softly on the old house, and she listened for a long time. ";
  for (const n of [1, 2, 3]) {
    zip.file(
      `OEBPS/chapter_${n}.xhtml`,
      xhtml(
        `<h2>Chapter ${n}: Part ${n}</h2><p>${paragraph.repeat(6)}</p><p>${paragraph.repeat(4)}</p>`,
      ),
    );
  }
  return zip.generateAsync({ type: "nodebuffer" });
}
