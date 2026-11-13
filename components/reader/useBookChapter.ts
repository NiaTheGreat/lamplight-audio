"use client";

import { useEffect, useRef, useState } from "react";
import { getReaderChapter } from "@/lib/client/reader";
import type { ReaderChapterData } from "@/lib/reader/types";

/**
 * The chapter being read in the book-only view. Chapters already fetched are kept (a few either
 * side of the one open), and the next two are fetched in the background, so turning the page
 * past the end of a chapter doesn't wait for the server.
 */
export function useBookChapter(bookId: string, chapter: number, total: number) {
  const cache = useRef(new Map<string, Promise<ReaderChapterData | null>>());
  const [data, setData] = useState<ReaderChapterData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    const load = (n: number) => {
      const key = `${bookId}:${n}`;
      let p = cache.current.get(key);
      if (!p) {
        p = getReaderChapter(bookId, n, true).then((d) => {
          if (!d) cache.current.delete(key); // try again next time
          return d;
        });
        cache.current.set(key, p);
      }
      return p;
    };
    setFailed(false);
    void load(chapter).then((d) => {
      if (!alive) return;
      if (d) {
        setData(d);
        // Then the chapters likely to be turned to next.
        for (const n of [chapter + 1, chapter + 2, chapter - 1]) {
          if (n >= 0 && n < total) void load(n);
        }
      } else setFailed(true);
    });
    // Keep only what is near.
    for (const key of [...cache.current.keys()]) {
      const n = Number(key.split(":")[1]);
      if (!key.startsWith(`${bookId}:`) || Math.abs(n - chapter) > 3) cache.current.delete(key);
    }
    return () => {
      alive = false;
    };
  }, [bookId, chapter, total]);

  return { data: data && data.chapter === chapter ? data : null, failed };
}
