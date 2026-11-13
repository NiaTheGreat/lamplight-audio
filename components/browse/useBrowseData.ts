"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "@/components/PlayerProvider";
import type { FilterContext } from "@/lib/catalog/filter";
import type { CatalogItem, ReadingEntry } from "@/lib/catalog/meta";
import { readState } from "@/lib/catalog/readstate";
import { getCatalog, getReading, readDetails } from "@/lib/client/api";

const CHUNK = 8;

/**
 * Everything Browse shows: the catalog, joined with the Shelf (so books added before Browse
 * appear too), the reading record and the listening position. Books that have no details yet
 * get them read from their kept EPUB, a few at a time.
 */
export function useBrowseData() {
  const p = usePlayer();
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [reader, setReader] = useState(false);
  const [reading, setReading] = useState<Record<string, ReadingEntry>>({});
  const [error, setError] = useState("");
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null);
  const backfilling = useRef(false);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([getCatalog(), getReading()]);
    if (c) {
      setCatalog(c.items);
      setReader(c.reader);
      setError("");
    } else setError("Couldn't load your library. Check your connection and try again.");
    setReading(r);
    return c?.items ?? null;
  }, []);

  // Load on arrival, and again when coming back to the tab (what you read elsewhere shows up).
  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const missing = useMemo(() => {
    if (!catalog || !p.libraryLoaded) return [];
    const have = new Set(catalog.map((i) => i.id));
    return p.library.filter((b) => !have.has(b.id)).map((b) => b.id);
  }, [catalog, p.library, p.libraryLoaded]);

  // A stable key, so a refresh of the lists doesn't restart the backfill half way.
  const missingKey = missing.join(",");

  // Books from before Browse: read their details once.
  useEffect(() => {
    if (!missingKey || backfilling.current) return;
    const ids = missingKey.split(",");
    backfilling.current = true;
    let alive = true;
    void (async () => {
      let done = 0;
      for (let i = 0; i < ids.length && alive; i += CHUNK) {
        setBackfill({ done, total: ids.length });
        await readDetails(ids.slice(i, i + CHUNK));
        done = Math.min(ids.length, i + CHUNK);
      }
      if (alive) {
        await load();
        setBackfill(null);
      }
    })();
    return () => {
      alive = false;
      backfilling.current = false;
    };
  }, [missingKey, load]);

  // Shelf books that still have no details (being read) show with just a title.
  const items = useMemo<CatalogItem[]>(() => {
    if (!catalog) return [];
    const have = new Set(catalog.map((i) => i.id));
    const extra: CatalogItem[] = p.library
      .filter((b) => !have.has(b.id))
      .map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        words: Math.round((b.chars ?? []).reduce((n, c) => n + c, 0) / 5.7),
        chars: (b.chars ?? []).reduce((n, c) => n + c, 0),
        chapters: b.chapterCount,
        source: "none" as const,
        addedAt: b.addedAt,
      }));
    return [...catalog, ...extra];
  }, [catalog, p.library]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const shelf = useMemo(() => new Map(p.library.map((b) => [b.id, b])), [p.library]);

  const ctx = useMemo<FilterContext>(
    () => ({
      read: (id) => readState(reading[id], p.progress.books[id], byId.get(id)?.chapters ?? 0),
      narrated: (id) => ({
        done: shelf.get(id)?.narrated?.length ?? 0,
        total: byId.get(id)?.chapters ?? 0,
      }),
    }),
    [reading, p.progress.books, byId, shelf],
  );

  return {
    items,
    loaded: catalog !== null,
    reader,
    error,
    backfill,
    ctx,
    shelf,
    reading,
    reload: load,
  };
}
