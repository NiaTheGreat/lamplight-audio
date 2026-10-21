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
    if (!title && t && !NOTE_HEADING.test(t)) title = t;
  });
  if (!title) title = $("title").first().text().replace(/\s+/g, " ").trim();

  $("script, style, head, nav").remove();

  if (skipNotes) {
    // AO3 structure: .meta groups hold chapter summary/notes/end notes.
    $(".meta, #notes, #summary, #endnotes, .notes, .summary").remove();
    // Generic: a "Notes"/"Summary" heading plus the blockquote(s) right after it.
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const heading = $(el);
      if (!NOTE_HEADING.test(heading.text())) return;
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

  const chapters: Chapter[] = [];
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
    if (text.replace(/\s/g, "").length < 20) continue;

    const index = chapters.length;
    const heading = title || `Chapter ${index + 1}`;
    const spoken =
      announceTitles && !text.toLowerCase().startsWith(heading.toLowerCase())
        ? `${/[.!?:]$/.test(heading) ? heading : `${heading}.`}\n\n${text}`
        : text;
    chapters.push({ index, title: heading, text: spoken });
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
