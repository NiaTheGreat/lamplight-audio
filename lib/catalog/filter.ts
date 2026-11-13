import type { CatalogItem } from "./meta";
import type { ReadState } from "./readstate";

export const PAGE_SIZE = 25;

export type SortKey = "opened" | "updated" | "published" | "added" | "title" | "author" | "words";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "opened", label: "Recently opened" },
  { key: "added", label: "Date added" },
  { key: "updated", label: "Last updated" },
  { key: "published", label: "Published" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
  { key: "words", label: "Word count" },
];

export type Filters = {
  q: string;
  fandom: string;
  lang: string;
  rating: string[];
  minWords?: number;
  maxWords?: number;
  complete: boolean;
  include: string[];
  exclude: string[];
  read: "" | "unread" | "reading" | "finished";
  narr: "" | "none" | "partly" | "full";
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
};

export const DEFAULT_FILTERS: Filters = {
  q: "",
  fandom: "",
  lang: "",
  rating: [],
  complete: false,
  include: [],
  exclude: [],
  read: "",
  narr: "",
  sort: "opened",
  dir: "desc",
  page: 1,
};

/** What the list needs to know about each fic that isn't in the catalog itself. */
export type FilterContext = {
  read: (id: string) => ReadState;
  /** Chapters narrated, out of the total. */
  narrated: (id: string) => { done: number; total: number };
};

const list = (v: string | null) =>
  (v ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string | null) => {
  const n = Number(v);
  return v && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
};

/** Filters from a URL query (back/forward, bookmarks and refresh keep the same view). */
export function parseFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort") as SortKey | null;
  const read = params.get("read");
  const narr = params.get("narr");
  const page = Number(params.get("page"));
  return {
    q: params.get("q") ?? "",
    fandom: params.get("fandom") ?? "",
    lang: params.get("lang") ?? "",
    rating: list(params.get("rating")),
    minWords: num(params.get("min")),
    maxWords: num(params.get("max")),
    complete: params.get("complete") === "1",
    include: list(params.get("tag")),
    exclude: list(params.get("not")),
    read: read === "unread" || read === "reading" || read === "finished" ? read : "",
    narr: narr === "none" || narr === "partly" || narr === "full" ? narr : "",
    sort: SORTS.some((s) => s.key === sort) ? (sort as SortKey) : DEFAULT_FILTERS.sort,
    dir: params.get("dir") === "asc" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

/** The query for a set of filters; anything left at its default is omitted. */
export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  const d = DEFAULT_FILTERS;
  if (f.q) p.set("q", f.q);
  if (f.fandom) p.set("fandom", f.fandom);
  if (f.lang) p.set("lang", f.lang);
  if (f.rating.length) p.set("rating", f.rating.join("|"));
  if (f.minWords !== undefined) p.set("min", String(f.minWords));
  if (f.maxWords !== undefined) p.set("max", String(f.maxWords));
  if (f.complete) p.set("complete", "1");
  if (f.include.length) p.set("tag", f.include.join("|"));
  if (f.exclude.length) p.set("not", f.exclude.join("|"));
  if (f.read) p.set("read", f.read);
  if (f.narr) p.set("narr", f.narr);
  if (f.sort !== d.sort) p.set("sort", f.sort);
  if (f.dir !== d.dir) p.set("dir", f.dir);
  if (f.page > 1) p.set("page", String(f.page));
  return p;
}

/** How many filters are applied (not counting sort and page). */
export function activeCount(f: Filters): number {
  return (
    (f.q ? 1 : 0) +
    (f.fandom ? 1 : 0) +
    (f.lang ? 1 : 0) +
    f.rating.length +
    (f.minWords !== undefined || f.maxWords !== undefined ? 1 : 0) +
    (f.complete ? 1 : 0) +
    f.include.length +
    f.exclude.length +
    (f.read ? 1 : 0) +
    (f.narr ? 1 : 0)
  );
}

export const isComplete = (i: CatalogItem): boolean | undefined => i.completeOverride ?? i.complete;

/** Everything a tag filter can match: tags, hand-added tags, pairings, characters, warnings, category. */
export function itemTags(i: CatalogItem): string[] {
  return [
    ...(i.tags ?? []),
    ...(i.userTags ?? []),
    ...(i.relationships ?? []),
    ...(i.characters ?? []),
    ...(i.warnings ?? []),
    ...(i.category ?? []),
  ];
}

const norm = (s: string) => s.toLowerCase();

function searchText(i: CatalogItem): string {
  return norm(
    [i.title, i.author, i.summary, ...(i.fandoms ?? []), ...itemTags(i), i.series].join("\n"),
  );
}

function sortValue(i: CatalogItem, key: SortKey, ctx: FilterContext): number | string | undefined {
  switch (key) {
    case "opened":
      return ctx.read(i.id).at || undefined;
    case "added":
      return i.addedAt;
    case "updated":
      return i.updated ?? i.published;
    case "published":
      return i.published;
    case "title":
      return norm(i.title.replace(/^(the|a|an)\s+/i, ""));
    case "author":
      return norm(i.author ?? "");
    case "words":
      return i.words;
  }
}

export function applyFilters(items: CatalogItem[], f: Filters, ctx: FilterContext): CatalogItem[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const include = f.include.map(norm);
  const exclude = f.exclude.map(norm);
  const out = items.filter((i) => {
    if (words.length) {
      const hay = searchText(i);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (f.fandom && !(i.fandoms ?? []).includes(f.fandom)) return false;
    if (f.lang && i.language !== f.lang) return false;
    if (f.rating.length && !(i.rating && f.rating.includes(i.rating))) return false;
    if (f.minWords !== undefined && i.words < f.minWords) return false;
    if (f.maxWords !== undefined && i.words > f.maxWords) return false;
    if (f.complete && isComplete(i) !== true) return false;
    if (include.length || exclude.length) {
      const tags = itemTags(i).map(norm);
      if (!include.every((t) => tags.includes(t))) return false;
      if (exclude.some((t) => tags.includes(t))) return false;
    }
    if (f.read && ctx.read(i.id).kind !== f.read) return false;
    if (f.narr) {
      const n = ctx.narrated(i.id);
      const kind = n.done === 0 ? "none" : n.done >= n.total ? "full" : "partly";
      if (kind !== f.narr) return false;
    }
    return true;
  });

  const sign = f.dir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    const x = sortValue(a, f.sort, ctx);
    const y = sortValue(b, f.sort, ctx);
    // Fics with no value for this sort go last, whichever way it runs.
    if (x === undefined && y !== undefined) return 1;
    if (y === undefined && x !== undefined) return -1;
    if (x !== undefined && y !== undefined && x !== y) return (x < y ? -1 : 1) * sign;
    return b.addedAt - a.addedAt || a.title.localeCompare(b.title);
  });
}

export type Facets = {
  languages: [string, number][];
  fandoms: [string, number][];
  ratings: [string, number][];
  tags: [string, number][];
  completeCount: number;
};

function count(values: Iterable<string>): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** What the filter lists offer, with how many fics each matches. */
export function facets(items: CatalogItem[]): Facets {
  return {
    languages: count(items.flatMap((i) => (i.language ? [i.language] : []))),
    fandoms: count(items.flatMap((i) => i.fandoms ?? [])),
    ratings: count(items.flatMap((i) => (i.rating ? [i.rating] : []))),
    tags: count(items.flatMap((i) => [...new Set(itemTags(i))])),
    completeCount: items.filter((i) => isComplete(i) === true).length,
  };
}

export function pageSlice<T>(list: T[], page: number): { rows: T[]; pages: number; page: number } {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  return { rows: list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), pages, page: p };
}
