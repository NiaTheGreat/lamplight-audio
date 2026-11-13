"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import {
  DEFAULT_FILTERS,
  SORTS,
  type Facets,
  type Filters,
  type SortKey,
} from "@/lib/catalog/filter";

/** Length buckets, in words. */
const LENGTHS: { label: string; min?: number; max?: number }[] = [
  { label: "Any" },
  { label: "Under 20k", max: 19_999 },
  { label: "20–100k", min: 20_000, max: 99_999 },
  { label: "100k+", min: 100_000 },
];

const READ: { key: Filters["read"]; label: string }[] = [
  { key: "unread", label: "Unread" },
  { key: "reading", label: "In progress" },
  { key: "finished", label: "Finished" },
];
const NARR: { key: Filters["narr"]; label: string }[] = [
  { key: "none", label: "Not narrated" },
  { key: "partly", label: "Partly" },
  { key: "full", label: "Fully narrated" },
];

export function lengthLabel(f: Pick<Filters, "minWords" | "maxWords">): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (f.minWords !== undefined && f.maxWords !== undefined)
    return `${n(f.minWords)}–${n(f.maxWords)} words`;
  if (f.minWords !== undefined) return `${n(f.minWords)}+ words`;
  if (f.maxWords !== undefined) return `Under ${n(f.maxWords + 1)} words`;
  return "Any length";
}

/** All the filters and the sort, for the side column on a wide screen and the sheet on a phone. */
export function FilterPanel({
  filters,
  facets,
  set,
}: {
  filters: Filters;
  facets: Facets;
  set: (patch: Partial<Filters>) => void;
}) {
  const [tagText, setTagText] = useState("");
  const same = (b: { min?: number; max?: number }) =>
    b.min === filters.minWords && b.max === filters.maxWords;

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  // A popular tag: tap to include, tap again to exclude, once more to clear.
  const cycleTag = (t: string) => {
    if (filters.include.includes(t))
      set({ include: filters.include.filter((x) => x !== t), exclude: [...filters.exclude, t] });
    else if (filters.exclude.includes(t)) set({ exclude: filters.exclude.filter((x) => x !== t) });
    else set({ include: [...filters.include, t] });
  };
  const addTag = (mode: "include" | "exclude") => {
    const t = tagText.trim();
    if (!t) return;
    const match = facets.tags.find(([x]) => x.toLowerCase() === t.toLowerCase());
    const name = match ? match[0] : t;
    const other = mode === "include" ? "exclude" : "include";
    set({
      [mode]: filters[mode].includes(name) ? filters[mode] : [...filters[mode], name],
      [other]: filters[other].filter((x) => x !== name),
    });
    setTagText("");
  };
  const suggestions =
    tagText.trim().length >= 2
      ? facets.tags
          .filter(([t]) => t.toLowerCase().includes(tagText.trim().toLowerCase()))
          .slice(0, 8)
      : [];

  return (
    <div className="bw-panel">
      <div className="bw-group">
        <label className="eyebrow" htmlFor="bw-sort">
          Sort
        </label>
        <div className="bw-row">
          <select
            id="bw-sort"
            className="bw-select"
            value={filters.sort}
            onChange={(e) => set({ sort: e.target.value as SortKey })}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="bw-dir"
            aria-label={
              filters.dir === "desc"
                ? "Descending: switch to ascending"
                : "Ascending: switch to descending"
            }
            onClick={() => set({ dir: filters.dir === "desc" ? "asc" : "desc" })}
          >
            {filters.dir === "desc" ? "↓" : "↑"}
          </button>
        </div>
      </div>

      <div className="bw-group">
        <span className="eyebrow">Your reading</span>
        <div className="bw-chips">
          {READ.map((r) => (
            <button
              key={r.key}
              className={`bw-chip${filters.read === r.key ? " on" : ""}`}
              aria-pressed={filters.read === r.key}
              onClick={() => set({ read: filters.read === r.key ? "" : r.key })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bw-group">
        <span className="eyebrow">Narration</span>
        <div className="bw-chips">
          {NARR.map((r) => (
            <button
              key={r.key}
              className={`bw-chip${filters.narr === r.key ? " on" : ""}`}
              aria-pressed={filters.narr === r.key}
              onClick={() => set({ narr: filters.narr === r.key ? "" : r.key })}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bw-group">
        <span className="eyebrow">Length</span>
        <div className="bw-seg" role="group" aria-label="Length">
          {LENGTHS.map((b) => (
            <button
              key={b.label}
              className={same(b) ? "on" : ""}
              aria-pressed={same(b)}
              onClick={() => set({ minWords: b.min, maxWords: b.max })}
            >
              {b.label}
            </button>
          ))}
        </div>
        <label className="bw-check">
          <input
            type="checkbox"
            checked={filters.complete}
            onChange={(e) => set({ complete: e.target.checked })}
          />
          <span>Complete works only ({facets.completeCount})</span>
        </label>
      </div>

      {facets.languages.length > 1 || filters.lang ? (
        <div className="bw-group">
          <label className="eyebrow" htmlFor="bw-lang">
            Language
          </label>
          <select
            id="bw-lang"
            className="bw-select"
            value={filters.lang}
            onChange={(e) => set({ lang: e.target.value })}
          >
            <option value="">All languages</option>
            {facets.languages.map(([l, n]) => (
              <option key={l} value={l}>
                {l} ({n})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {facets.ratings.length > 0 ? (
        <div className="bw-group">
          <span className="eyebrow">Rating</span>
          <div className="bw-chips">
            {facets.ratings.map(([r, n]) => (
              <button
                key={r}
                className={`bw-chip${filters.rating.includes(r) ? " on" : ""}`}
                aria-pressed={filters.rating.includes(r)}
                onClick={() => set({ rating: toggle(filters.rating, r) })}
              >
                {r} ({n})
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {facets.fandoms.length > 0 ? (
        <div className="bw-group">
          <label className="eyebrow" htmlFor="bw-fandom">
            Fandom
          </label>
          <select
            id="bw-fandom"
            className="bw-select"
            value={filters.fandom}
            onChange={(e) => set({ fandom: e.target.value })}
          >
            <option value="">All fandoms</option>
            {facets.fandoms.slice(0, 200).map(([f, n]) => (
              <option key={f} value={f}>
                {f} ({n})
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="bw-group">
        <label className="eyebrow" htmlFor="bw-tag">
          Tags
        </label>
        <div className="bw-row wrap">
          <input
            id="bw-tag"
            className="bw-input"
            placeholder="Type 2+ letters"
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTag("include")}
            list="bw-tag-list"
            autoComplete="off"
          />
          <datalist id="bw-tag-list">
            {suggestions.map(([t]) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button className="bw-mini" onClick={() => addTag("include")} disabled={!tagText.trim()}>
            Include
          </button>
          <button className="bw-mini" onClick={() => addTag("exclude")} disabled={!tagText.trim()}>
            Exclude
          </button>
        </div>
        {filters.include.length + filters.exclude.length > 0 ? (
          <div className="bw-chips" style={{ marginTop: 8 }}>
            {filters.include.map((t) => (
              <button
                key={`i${t}`}
                className="bw-chip on"
                onClick={() => set({ include: filters.include.filter((x) => x !== t) })}
              >
                {t} <Icon name="close" size={12} />
              </button>
            ))}
            {filters.exclude.map((t) => (
              <button
                key={`e${t}`}
                className="bw-chip out"
                onClick={() => set({ exclude: filters.exclude.filter((x) => x !== t) })}
              >
                not {t} <Icon name="close" size={12} />
              </button>
            ))}
          </div>
        ) : null}
        {facets.tags.length > 0 ? (
          <>
            <div className="faint" style={{ fontSize: 12, margin: "12px 0 6px" }}>
              Popular tags. Tap to include, again to exclude.
            </div>
            <div className="bw-chips">
              {facets.tags.slice(0, 14).map(([t, n]) => (
                <button
                  key={t}
                  className={`bw-chip${filters.include.includes(t) ? " on" : ""}${filters.exclude.includes(t) ? " out" : ""}`}
                  onClick={() => cycleTag(t)}
                >
                  {t} ({n})
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <button
        className="bw-reset"
        onClick={() => set({ ...DEFAULT_FILTERS, sort: filters.sort, dir: filters.dir })}
      >
        Reset filters
      </button>
    </div>
  );
}
