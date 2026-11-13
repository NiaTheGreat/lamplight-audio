import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  PAGE_SIZE,
  activeCount,
  applyFilters,
  facets,
  filtersToParams,
  pageSlice,
  parseFilters,
  type FilterContext,
} from "@/lib/catalog/filter";
import type { CatalogItem, ReadingEntry } from "@/lib/catalog/meta";
import { readState } from "@/lib/catalog/readstate";

const item = (over: Partial<CatalogItem> & { id: string; title: string }): CatalogItem => ({
  words: 1000,
  chars: 5700,
  chapters: 3,
  source: "ao3-preface",
  addedAt: 1,
  ...over,
});

const A = item({
  id: "a",
  title: "The Long Way",
  author: "quill",
  summary: "A lighthouse keeper drives the last bus.",
  fandoms: ["Harbor Lights"],
  rating: "Mature",
  language: "English",
  words: 142_000,
  complete: true,
  tags: ["Found Family", "Slow Burn"],
  relationships: ["Imogen/Tomas"],
  updated: "2025-03-02",
  addedAt: 3,
});
const B = item({
  id: "b",
  title: "Salt, Then Silver",
  author: "marrow",
  fandoms: ["Wrackline"],
  rating: "Explicit",
  language: "English",
  words: 9_000,
  complete: false,
  tags: ["Slow Burn", "Angst"],
  updated: "2024-11-19",
  addedAt: 2,
});
const C = item({ id: "c", title: "An Untitled Thing", source: "epub", words: 50_000, addedAt: 1 });
const ALL = [A, B, C];

const reading: Record<string, ReadingEntry> = {
  b: { chapter: 1, done: [0], updatedAt: 500 },
  c: { chapter: 2, done: [2], finished: true, updatedAt: 400 },
};
const ctx: FilterContext = {
  read: (id) => readState(reading[id], undefined, ALL.find((i) => i.id === id)?.chapters ?? 0),
  narrated: (id) => ({ done: id === "a" ? 3 : id === "b" ? 1 : 0, total: 3 }),
};
const run = (patch: Partial<typeof DEFAULT_FILTERS>) =>
  applyFilters(ALL, { ...DEFAULT_FILTERS, ...patch }, ctx).map((i) => i.id);

describe("applyFilters", () => {
  it("searches title, author, summary and tags, every word", () => {
    expect(run({ q: "lighthouse bus" })).toEqual(["a"]);
    expect(run({ q: "marrow" })).toEqual(["b"]);
    expect(run({ q: "angst" })).toEqual(["b"]);
    expect(run({ q: "angst lighthouse" })).toEqual([]);
  });

  it("filters by length, complete, rating, language and fandom", () => {
    expect(run({ minWords: 100_000 })).toEqual(["a"]);
    expect(run({ maxWords: 19_999 })).toEqual(["b"]);
    expect(run({ complete: true })).toEqual(["a"]);
    expect(run({ rating: ["Explicit", "Mature"], sort: "words" })).toEqual(["a", "b"]);
    expect(run({ lang: "English", sort: "words" })).toEqual(["a", "b"]);
    expect(run({ fandom: "Wrackline" })).toEqual(["b"]);
  });

  it("includes and excludes tags (also pairings), ignoring case", () => {
    expect(run({ include: ["slow burn"], sort: "words" })).toEqual(["a", "b"]);
    expect(run({ include: ["Slow Burn"], exclude: ["angst"] })).toEqual(["a"]);
    expect(run({ include: ["imogen/tomas"] })).toEqual(["a"]);
  });

  it("a hand-set complete flag wins over the file", () => {
    const flipped = [{ ...B, completeOverride: true }];
    expect(applyFilters(flipped, { ...DEFAULT_FILTERS, complete: true }, ctx)).toHaveLength(1);
    expect(
      applyFilters(
        [{ ...A, completeOverride: false }],
        { ...DEFAULT_FILTERS, complete: true },
        ctx,
      ),
    ).toHaveLength(0);
  });

  it("filters by reading and narration state", () => {
    expect(run({ read: "unread" })).toEqual(["a"]);
    expect(run({ read: "reading" })).toEqual(["b"]);
    expect(run({ read: "finished" })).toEqual(["c"]);
    expect(run({ narr: "full" })).toEqual(["a"]);
    expect(run({ narr: "partly" })).toEqual(["b"]);
    expect(run({ narr: "none" })).toEqual(["c"]);
  });

  it("sorts, putting fics with no value last either way", () => {
    // Leading "The", "A", "An" are ignored: long way, salt, untitled thing.
    expect(run({ sort: "title", dir: "asc" })).toEqual(["a", "b", "c"]);
    expect(run({ sort: "words", dir: "desc" })).toEqual(["a", "c", "b"]);
    expect(run({ sort: "updated", dir: "desc" })).toEqual(["a", "b", "c"]);
    expect(run({ sort: "updated", dir: "asc" })).toEqual(["b", "a", "c"]);
    // Recently opened: the one read last first, never-opened ones after, newest added first.
    expect(run({ sort: "opened" })).toEqual(["b", "c", "a"]);
  });
});

describe("filters in the address", () => {
  it("round-trips, and leaves defaults out", () => {
    const f = {
      ...DEFAULT_FILTERS,
      q: "bus",
      lang: "English",
      minWords: 100000,
      complete: true,
      include: ["Slow Burn", "Found Family"],
      exclude: ["Angst"],
      read: "reading" as const,
      sort: "words" as const,
      dir: "asc" as const,
      page: 3,
    };
    const params = filtersToParams(f);
    expect(parseFilters(new URLSearchParams(params.toString()))).toEqual(f);
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("ignores junk values", () => {
    const f = parseFilters(new URLSearchParams("sort=nope&read=zzz&page=-4&min=abc&dir=up"));
    expect(f).toEqual(DEFAULT_FILTERS);
  });

  it("counts applied filters", () => {
    expect(activeCount(DEFAULT_FILTERS)).toBe(0);
    expect(
      activeCount({ ...DEFAULT_FILTERS, q: "x", complete: true, include: ["a", "b"], minWords: 5 }),
    ).toBe(5);
  });
});

describe("facets and pages", () => {
  it("counts what the lists offer", () => {
    const f = facets(ALL);
    expect(f.languages).toEqual([["English", 2]]);
    expect(f.ratings).toEqual([
      ["Explicit", 1],
      ["Mature", 1],
    ]);
    expect(f.tags[0]).toEqual(["Slow Burn", 2]);
    expect(f.completeCount).toBe(1);
  });

  it("pages in 25s and clamps the page number", () => {
    const many = Array.from({ length: PAGE_SIZE * 2 + 1 }, (_, i) => i);
    expect(pageSlice(many, 1).rows).toHaveLength(PAGE_SIZE);
    expect(pageSlice(many, 3)).toMatchObject({ pages: 3, page: 3 });
    expect(pageSlice(many, 99).page).toBe(3);
    expect(pageSlice([], 1)).toEqual({ rows: [], pages: 1, page: 1 });
  });
});

describe("readState", () => {
  const e = (over: Partial<ReadingEntry>): ReadingEntry => ({
    chapter: 0,
    done: [],
    updatedAt: 100,
    ...over,
  });

  it("is unread with no activity", () => {
    expect(readState(undefined, undefined, 10).kind).toBe("unread");
  });
  it("is reading from the reading record or the listening position, whichever is later", () => {
    expect(readState(e({ chapter: 4 }), undefined, 10)).toMatchObject({
      kind: "reading",
      chapter: 4,
    });
    expect(readState(undefined, { chapter: 6, updatedAt: 50 }, 10)).toMatchObject({
      kind: "reading",
      chapter: 6,
    });
    expect(
      readState(e({ chapter: 4, updatedAt: 100 }), { chapter: 6, updatedAt: 200 }, 10).chapter,
    ).toBe(6);
    expect(
      readState(e({ chapter: 4, updatedAt: 300 }), { chapter: 6, updatedAt: 200 }, 10).chapter,
    ).toBe(4);
  });
  it("is finished when marked or when the last chapter was read to the end", () => {
    expect(readState(e({ finished: true }), undefined, 10).kind).toBe("finished");
  });
  it("marking unread hides older listening, but newer listening counts again", () => {
    const unread = e({ finished: false, updatedAt: 500 });
    expect(readState(unread, { chapter: 3, updatedAt: 400 }, 10).kind).toBe("unread");
    expect(readState(unread, { chapter: 3, updatedAt: 600 }, 10)).toMatchObject({
      kind: "reading",
      chapter: 3,
    });
  });
  it("keeps the chapter inside the book", () => {
    expect(readState(e({ chapter: 99 }), undefined, 10).chapter).toBe(9);
  });
});
