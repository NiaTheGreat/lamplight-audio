import { parseEpub } from "../epub";
import { getObject, putObject, deleteObject } from "../storage/storage";
import type { Book } from "../types";
import { countWords, type CatalogItem, type FicMeta } from "./meta";
import { mergeMeta } from "./extract";

/**
 * The Browse list lives in one small file, `catalog/index.json`, so showing it costs a single
 * read however many fics there are (the Shelf lists `library/` and reads every entry, which
 * would be slow at hundreds of fics). The full summary is kept apart in `catalog/<id>.json`.
 * A fic that is in the catalog but has no `library/<id>.json` is "Browse only": not on the Shelf.
 */
const INDEX_KEY = "catalog/index.json";
const recordKey = (id: string) => `catalog/${id}.json`;

export type CatalogIndex = { v: 1; items: CatalogItem[] };

const clip = (s: string | undefined, n: number) =>
  s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
const cap = <T>(a: T[] | undefined, n: number) => (a && a.length ? a.slice(0, n) : undefined);

export async function readCatalog(): Promise<CatalogIndex> {
  const raw = await getObject(INDEX_KEY);
  if (!raw) return { v: 1, items: [] };
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as CatalogIndex;
    if (parsed.v === 1 && Array.isArray(parsed.items)) return parsed;
  } catch {
    /* a damaged index is rebuilt by the backfill */
  }
  return { v: 1, items: [] };
}

const writeCatalog = (index: CatalogIndex) =>
  putObject(INDEX_KEY, JSON.stringify(index), "application/json");

/** A catalog item from a parsed book and its details. `keep` carries what the reader set by hand. */
export function toItem(
  book: Pick<Book, "id" | "title" | "author" | "chapters">,
  meta: FicMeta,
  addedAt: number,
  keep?: Pick<CatalogItem, "userTags" | "completeOverride">,
): CatalogItem {
  const item: CatalogItem = {
    id: book.id,
    title: book.title,
    author: book.author,
    summary: clip(meta.summary, 400),
    fandoms: cap(meta.fandoms, 6),
    rating: meta.rating,
    category: cap(meta.category, 6),
    warnings: cap(meta.warnings, 8),
    relationships: cap(meta.relationships, 8),
    characters: cap(meta.characters, 12),
    tags: cap(meta.tags, 40),
    series: meta.series,
    language: meta.language,
    words: meta.words ?? book.chapters.reduce((n, c) => n + countWords(c.text), 0),
    chars: book.chapters.reduce((n, c) => n + c.text.length, 0),
    chapters: book.chapters.length,
    chaptersTotal: meta.chaptersTotal,
    complete: meta.complete,
    published: meta.published,
    updated: meta.updated,
    workId: meta.workId,
    source: meta.source,
    addedAt,
    ...keep,
  };
  // Drop empty fields so the index stays small.
  for (const k of Object.keys(item) as (keyof CatalogItem)[])
    if (item[k] === undefined) delete item[k];
  return item;
}

/** Add or replace a fic in the catalog. Never throws: details are an extra, not a reason to fail an upload. */
export async function upsertItem(item: CatalogItem, fullSummary?: string): Promise<void> {
  try {
    const index = await readCatalog();
    const at = index.items.findIndex((i) => i.id === item.id);
    if (at >= 0) {
      const old = index.items[at];
      index.items[at] = {
        ...item,
        addedAt: old.addedAt,
        userTags: old.userTags,
        completeOverride: old.completeOverride,
      };
      if (index.items[at].userTags === undefined) delete index.items[at].userTags;
      if (index.items[at].completeOverride === undefined) delete index.items[at].completeOverride;
    } else index.items.push(item);
    await writeCatalog(index);
    if (fullSummary)
      await putObject(
        recordKey(item.id),
        JSON.stringify({ summary: fullSummary }),
        "application/json",
      );
  } catch {
    /* best effort */
  }
}

export async function getFullSummary(id: string): Promise<string | undefined> {
  const raw = await getObject(recordKey(id)).catch(() => null);
  if (!raw) return undefined;
  try {
    return (JSON.parse(raw.toString("utf8")) as { summary?: string }).summary;
  } catch {
    return undefined;
  }
}

/** Hand edits: tags added by the reader, and complete / in progress. */
export async function patchItem(
  id: string,
  patch: { userTags?: string[]; completeOverride?: boolean | null },
): Promise<CatalogItem | null> {
  const index = await readCatalog();
  const item = index.items.find((i) => i.id === id);
  if (!item) return null;
  if (patch.userTags) {
    const tags = [
      ...new Set(patch.userTags.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean)),
    ].slice(0, 30);
    if (tags.length) item.userTags = tags;
    else delete item.userTags;
  }
  if (patch.completeOverride === null) delete item.completeOverride;
  else if (typeof patch.completeOverride === "boolean")
    item.completeOverride = patch.completeOverride;
  await writeCatalog(index);
  return item;
}

export async function removeItem(id: string): Promise<void> {
  const index = await readCatalog();
  const items = index.items.filter((i) => i.id !== id);
  if (items.length !== index.items.length) await writeCatalog({ v: 1, items });
  await deleteObject(recordKey(id)).catch(() => {});
}

/** Is this fic in the catalog? (Used to keep a Browse-only fic off the Shelf when it is opened.) */
export async function inCatalog(id: string): Promise<boolean> {
  try {
    return (await readCatalog()).items.some((i) => i.id === id);
  } catch {
    return false;
  }
}

/**
 * Read details for stored books and put them in the catalog (one index write for the lot): from the
 * kept EPUB when there is one, otherwise just counts from the stored text. Returns how many were done.
 */
export async function refreshItems(ids: string[]): Promise<number> {
  const index = await readCatalog();
  let done = 0;
  for (const id of ids) {
    const raw = await getObject(`books/${id}.json`).catch(() => null);
    if (!raw) continue;
    const book = JSON.parse(raw.toString("utf8")) as Book;
    let meta: FicMeta | null = null;
    const epub = await getObject(`epubs/${id}.epub`).catch(() => null);
    if (epub) {
      try {
        meta = (await parseEpub(epub, { meta: true })).meta ?? null;
      } catch {
        meta = null;
      }
    }
    if (!meta) meta = mergeMeta([], book.chapters);
    const full = meta.summary;
    const at = index.items.findIndex((i) => i.id === id);
    const old = at >= 0 ? index.items[at] : undefined;
    const item = toItem(book, meta, old?.addedAt ?? Date.now(), {
      userTags: old?.userTags,
      completeOverride: old?.completeOverride,
    });
    if (at >= 0) index.items[at] = item;
    else index.items.push(item);
    if (full)
      await putObject(recordKey(id), JSON.stringify({ summary: full }), "application/json").catch(
        () => {},
      );
    done++;
  }
  if (done) await writeCatalog(index);
  return done;
}
