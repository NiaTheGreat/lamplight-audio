import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import * as cheerio from "cheerio";
import type { Book, Chapter } from "./types";

export type ParseOptions = {
  /** Drop author's notes and summaries (default true). */
  skipNotes?: boolean;
  /** Read the chapter title aloud at the start of each chapter (default true). */
  announceTitles?: boolean;
};

// Headings like "Summary", "Chapter Summary", "Notes", "Author's Notes",
// "Chapter End Notes", "Work End Notes", "A/N".
const NOTE_HEADING =
  /^\s*(?:(?:work|chapter|author'?s?)\s+)?(?:end\s*)?(?:summary|notes?)\s*:?\s*$|^\s*a\/n\s*:?\s*$/i;

// AO3 landmark headings ("Chapter Text", "Work Text") label the story body for
// screen readers; they aren't story text and shouldn't be narrated or used as titles.
const LANDMARK_HEADING = /^\s*(?:chapter|work)\s+text\s*:?\s*$/i;

const FILE_NAME_TITLE = /^[/\\]|\.(?:pdf|docx?|txt|html?|epub|mobi)$/i;

// "Part Twelve: The One With the Kiss", "Chapter 3", "Book II - ..." on a line of its own.
const CHAPTER_HEADING =
  /^(?:part|chapter|book)\s+(?:[0-9a-z]+(?:-[a-z]+)?)\b\s*(?:[:.\-\u2013\u2014].{0,100})?$/i;
const NOTE_POINTER = /^see the end (?:of the (?:chapter|work) )?for (?:more )?notes\.?$/i;

const isChapterHeading = (line: string) =>
  line.length <= 120 &&
  line.split(/\s+/).length <= 16 &&
  CHAPTER_HEADING.test(line) &&
  !NOTE_HEADING.test(line);

// Files that are never story text.
const ALWAYS_SKIP_FILE =
  /(^|\/)(cover|nav|toc|titlepage|title[-_]?page|colophon|copyright)[^/]*$/i;
// AO3 puts the work summary/tags in preface.xhtml and end notes in afterword.xhtml.
const NOTE_FILE = /(^|\/)(preface|afterword)[^/]*$/i;

const BR = "\u0001";
const BLOCK = "\u0002";

export function extractChapter(
  html: string,
  skipNotes: boolean,
): { title: string; text: string } {
  const $ = cheerio.load(html);

  // Work out the chapter title before anything is removed.
  let title = "";
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (!title && t && !NOTE_HEADING.test(t) && !LANDMARK_HEADING.test(t)) title = t;
  });
  if (!title) title = $("title").first().text().replace(/\s+/g, " ").trim();
  // Converters sometimes put the source file name in <title>; that is not a chapter name.
  if (FILE_NAME_TITLE.test(title)) title = "";

  // Calibre-split AO3 EPUBs lose the preface.xhtml/afterword.xhtml file names,
  // but the wrapper ids survive.
  // The last chapter file can carry an empty #afterword after #chapters, so
  // only treat the page as notes when there is no story container.
  if (skipNotes && $("#preface, #afterword").length && !$("#chapters").length) {
    return { title, text: "" };
  }
  if (skipNotes) $("#preface, #afterword").remove();

  $("script, style, head, nav, .landmark").remove();
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    if (LANDMARK_HEADING.test($(el).text())) $(el).remove();
  });

  if (skipNotes) {
    // AO3 structure: .meta groups hold chapter summary/notes/end notes.
    $(".meta, #notes, #summary, #endnotes, .notes, .summary").remove();
    // Generic: a "Notes"/"Summary" heading plus the blockquote(s) right after it.
    // Calibre-converted AO3 EPUBs turn these headings into plain <p> labels, so
    // a <p> only counts when a blockquote follows it.
    $("h1, h2, h3, h4, h5, h6, p").each((_, el) => {
      const heading = $(el);
      if (!NOTE_HEADING.test(heading.text())) return;
      if (heading.is("p") && !heading.next().is("blockquote")) return;
      let next = heading.next();
      while (next.length && next.is("blockquote")) {
        const current = next;
        next = next.next();
        current.remove();
      }
      heading.remove();
    });
  }

  // cheerio always wraps parsed HTML in <html><body>, so body exists.
  const root = $("body");
  root.find("br").replaceWith(BR);
  root.find("p, div, h1, h2, h3, h4, h5, h6, li, blockquote, tr, hr").after(BLOCK);

  const text = normalize(root.text());
  return { title, text };
}

function normalize(raw: string): string {
  const lines = raw
    .replace(/\s+/g, " ")
    .replaceAll(BLOCK, "\n\n")
    .replaceAll(BR, "\n")
    .split("\n")
    .map((line) => line.trim())
    // Scene-break lines like "* * *" have nothing to read; keep them as a pause.
    .map((line) => (/[\p{L}\p{N}]/u.test(line) ? line : ""));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type RawFile = { title: string; text: string };

/**
 * Some EPUBs are converted from PDFs: the file is cut into pieces by page size, not by
 * chapter, the pieces have no headings, and chapter titles are just paragraphs such as
 * "Part Twelve: The One With the Kiss" (sometimes alone in a piece, sometimes stranded at
 * the end of the previous one). This joins the pieces and splits them again at those lines.
 */
export function looksReflowed(files: RawFile[]): boolean {
  const untitled = files.filter((f) => !f.title).length;
  const headings = files.reduce(
    (n, f) => n + f.text.split(/\n{2,}/).filter((p) => isChapterHeading(p.trim())).length,
    0,
  );
  return files.length >= 4 && untitled >= files.length / 2 && headings >= 3;
}

export function regroupByHeadings(
  files: RawFile[],
  opts: { skipNotes: boolean; announceTitles: boolean },
): Chapter[] {
  const paraOf = (f: RawFile) => f.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const startsWithHeading = files.map((f) => isChapterHeading(paraOf(f)[0] ?? ""));
  const headingFiles = files.map((f) => paraOf(f).some(isChapterHeading));

  const front: string[] = [];
  let seenHeading = false;
  let current: { title: string; paras: string[] } | null = null;
  let lastWasHeading = false; // the previous piece ended on a heading, so this one is its body
  const chapters: { title: string; paras: string[] }[] = [];

  files.forEach((file, i) => {
    const paras = paraOf(file);
    if (paras.length === 0) return;
    const chars = paras.join("").length;
    const laterHeadings = headingFiles.slice(i + 1).some(Boolean);
    // A small stray piece between chapters (or after the last one) is the author's note.
    if (
      opts.skipNotes &&
      seenHeading &&
      !lastWasHeading &&
      !startsWithHeading[i] &&
      chars < 1500 &&
      (startsWithHeading[i + 1] || !laterHeadings)
    ) {
      return;
    }
    lastWasHeading = isChapterHeading(paras[paras.length - 1]);
    for (const para of paras) {
      if (opts.skipNotes && NOTE_POINTER.test(para)) continue;
      if (isChapterHeading(para)) {
        seenHeading = true;
        current = { title: para, paras: [] };
        chapters.push(current);
      } else if (current) {
        current.paras.push(para);
      } else {
        front.push(para);
      }
    }
  });

  const out: Chapter[] = [];
  const add = (title: string, paras: string[]) => {
    const text = paras.join("\n\n");
    if (text.replace(/\s/g, "").length < 20) return;
    const spoken = opts.announceTitles
      ? `${/[.!?:]$/.test(title) ? title : `${title}.`}\n\n${text}`
      : text;
    out.push({ index: out.length, title, text: spoken });
  };
  // Whatever comes before the first heading is the cover, summary and work info.
  if (!opts.skipNotes) add("Introduction", front);
  for (const c of chapters) add(c.title, c.paras);
  return out;
}

export async function parseEpub(buf: Buffer, opts: ParseOptions = {}): Promise<Book> {
  const skipNotes = opts.skipNotes ?? true;
  const announceTitles = opts.announceTitles ?? true;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("That file isn't a valid EPUB.");
  }

  const read = async (p: string): Promise<string> => {
    const file = zip.file(p);
    if (!file) throw new Error(`The EPUB is missing ${p}.`);
    return file.async("string");
  };

  const container = cheerio.load(await read("META-INF/container.xml"), { xml: true });
  const opfPath = container("rootfile").attr("full-path");
  if (!opfPath) throw new Error("This EPUB has no package file.");

  const opf = cheerio.load(await read(opfPath), { xml: true });
  const baseDir = path.posix.dirname(opfPath);

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  opf("manifest > item").each((_, el) => {
    const item = opf(el);
    const id = item.attr("id");
    const href = item.attr("href");
    if (id && href) {
      manifest.set(id, {
        href,
        type: item.attr("media-type") ?? "",
        props: item.attr("properties") ?? "",
      });
    }
  });

  const raw: RawFile[] = [];
  const itemrefs = opf("spine > itemref").toArray();

  for (const el of itemrefs) {
    const ref = opf(el);
    if (ref.attr("linear") === "no") continue;
    const item = manifest.get(ref.attr("idref") ?? "");
    if (!item) continue;
    if (!/x?html/i.test(item.type) || /\bnav\b/.test(item.props)) continue;

    let href = item.href.split("#")[0];
    try {
      href = decodeURIComponent(href);
    } catch {
      /* keep raw href */
    }
    const full = path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, href));

    if (ALWAYS_SKIP_FILE.test(full)) continue;
    if (skipNotes && NOTE_FILE.test(full)) continue;
    if (!zip.file(full)) continue;

    const { title, text } = extractChapter(await read(full), skipNotes);
    if (text.trim()) raw.push({ title, text });
  }

  let chapters: Chapter[];
  if (looksReflowed(raw)) {
    chapters = regroupByHeadings(raw, { skipNotes, announceTitles });
  } else {
    chapters = [];
    for (const { title, text } of raw) {
      if (text.replace(/\s/g, "").length < 20) continue;
      const index = chapters.length;
      const heading = title || `Chapter ${index + 1}`;
      const spoken =
        announceTitles && !text.toLowerCase().startsWith(heading.toLowerCase())
          ? `${/[.!?:]$/.test(heading) ? heading : `${heading}.`}\n\n${text}`
          : text;
      chapters.push({ index, title: heading, text: spoken });
    }
  }

  if (chapters.length === 0) {
    throw new Error("Couldn't find any readable chapters in that EPUB.");
  }

  const title = opf("dc\\:title").first().text().trim() || "Untitled";
  const author = opf("dc\\:creator").first().text().trim() || undefined;
  const id = createHash("sha256")
    .update(buf)
    .update(skipNotes ? "notes-skipped" : "notes-kept")
    .digest("hex")
    .slice(0, 16);

  return { id, title, author, chapters };
}
