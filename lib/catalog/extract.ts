import * as cheerio from "cheerio";
import { countWords, type FicMeta } from "./meta";

const DATE_RE = /\d{4}-\d{2}-\d{2}/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function unique(items: string[]): string[] {
  return [...new Set(items.map(clean).filter(Boolean))];
}

/** Items of a <dd>: each link's text if it has links (AO3), otherwise comma-separated text. */
function listOf(dd: ReturnType<cheerio.CheerioAPI>, $: cheerio.CheerioAPI): string[] {
  const links = dd
    .find("a")
    .map((_, a) => $(a).text())
    .get();
  return unique(links.length ? links : dd.text().split(","));
}

/** Language names for codes like "en" (EPUB `dc:language`); unknown codes are left as they are. */
function languageName(value: string): string {
  const v = clean(value);
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/i.test(v)) return v;
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(v) ?? v;
  } catch {
    return v;
  }
}

/** "4,567" -> 4567; anything else -> undefined. */
const toInt = (s: string | undefined) =>
  s && /^[\d,]+$/.test(s) ? Number(s.replace(/,/g, "")) : undefined;

/**
 * The work-info block of an AO3 download: `<dl class="tags">` (Rating, Archive Warnings, Category,
 * Fandom, Relationship, Characters, Additional Tags, Language, Series, Stats) and the summary
 * after it. Returns null when the page has no such block. Written from AO3's usual markup;
 * `tests/catalog.test.ts` pins that shape.
 */
export function parseAo3Preface(html: string): FicMeta | null {
  const $ = cheerio.load(html);
  const dl = $("dl.tags").first();
  if (!dl.length) return null;
  const meta: FicMeta = { source: "ao3-preface" };

  dl.children("dt").each((_, dt) => {
    const label = clean($(dt).text()).replace(/:$/, "").toLowerCase();
    const dd = $(dt).next("dd");
    if (!dd.length) return;
    const text = clean(dd.text());
    if (/^rating/.test(label)) meta.rating = text;
    else if (/^(archive )?warning/.test(label)) meta.warnings = listOf(dd, $);
    else if (/^categor/.test(label)) meta.category = listOf(dd, $);
    else if (/^fandom/.test(label)) meta.fandoms = listOf(dd, $);
    else if (/^relationship/.test(label)) meta.relationships = listOf(dd, $);
    else if (/^character/.test(label)) meta.characters = listOf(dd, $);
    else if (/^additional tag|^freeform|^tags?$/.test(label)) meta.tags = listOf(dd, $);
    else if (/^language/.test(label)) meta.language = text;
    else if (/^series/.test(label)) meta.series = text;
    else if (/^stats/.test(label)) {
      const published = text.match(new RegExp(`Published:\\s*(${DATE_RE.source})`, "i"));
      const finished = text.match(new RegExp(`(Updated|Completed):\\s*(${DATE_RE.source})`, "i"));
      const words = text.match(/Words:\s*([\d,]+)/i);
      const chapters = text.match(/Chapters:\s*(\d+)\s*\/\s*(\d+|\?)/i);
      if (published) meta.published = published[1];
      if (finished) meta.updated = finished[2];
      meta.words = toInt(words?.[1]);
      if (chapters) {
        meta.chaptersDone = Number(chapters[1]);
        meta.chaptersTotal = chapters[2] === "?" ? undefined : Number(chapters[2]);
        // "5/5" is a finished work; "5/?" or "3/10" is still going.
        meta.complete = chapters[2] !== "?" && chapters[1] === chapters[2];
      }
      if (/Completed:/i.test(text)) meta.complete = true;
    }
  });

  // The summary follows the block, either right after the <dl> or after the <div> that holds it.
  let box = dl.nextAll("blockquote").first();
  for (const up of dl.parents().toArray().slice(0, 3)) {
    if (box.length) break;
    box = $(up).nextAll("blockquote").first();
  }
  if (!box.length) box = $("#summary blockquote").first();
  if (box.length) {
    const paras = box.find("p").length
      ? box
          .find("p")
          .map((_, p) => clean($(p).text()))
          .get()
      : [clean(box.text())];
    const text = paras.filter(Boolean).join("\n\n");
    if (text) meta.summary = text;
  }
  return meta;
}

/**
 * Details from the EPUB's own package file: `dc:description` (summary), `dc:subject` (a fandom
 * for AO3-derived files, otherwise tags), `dc:language`, `dc:date`, and an `urn:ao3:<n>` identifier.
 */
export function metaFromOpf(opf: cheerio.CheerioAPI): FicMeta {
  const meta: FicMeta = { source: "epub" };
  const description = clean(cheerio.load(opf("dc\\:description").first().text() || "").text());
  if (description) meta.summary = description;

  const id = opf("dc\\:identifier").first().text();
  const work = id.match(/urn:ao3:(\d+)/i);
  if (work) meta.workId = work[1];

  const subjects = unique(
    opf("dc\\:subject")
      .map((_, el) => opf(el).text())
      .get(),
  );
  if (subjects.length) {
    if (work) meta.fandoms = subjects;
    else meta.tags = subjects;
  }
  const language = opf("dc\\:language").first().text();
  if (language.trim()) meta.language = languageName(language);
  const date = opf("dc\\:date").first().text().match(DATE_RE);
  if (date) meta.published = date[0];
  return meta;
}

/** Fill gaps: the first source that has a field wins; word and chapter counts come from the text. */
export function mergeMeta(sources: (FicMeta | null)[], chapters: { text: string }[]): FicMeta {
  const out: FicMeta = { source: "epub" };
  for (const s of sources) {
    if (!s) continue;
    if (s.source === "ao3-preface") out.source = "ao3-preface";
    for (const [key, value] of Object.entries(s)) {
      if (key === "source" || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      const k = key as keyof FicMeta;
      if ((out as Record<string, unknown>)[k] === undefined)
        (out as Record<string, unknown>)[k] = value;
    }
  }
  if (out.words === undefined) out.words = chapters.reduce((n, c) => n + countWords(c.text), 0);
  if (out.chaptersDone === undefined) out.chaptersDone = chapters.length;
  return out;
}
