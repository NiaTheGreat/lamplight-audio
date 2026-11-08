"use client";

import { useEffect, useState } from "react";
import { getReaderChapter } from "@/lib/client/reader";
import type { ReaderChapterData } from "@/lib/reader/types";

/**
 * The chapter being read. Asked for again when the chapter is narrated while the reader is open,
 * since that is what makes its sentence times available.
 */
export function useChapterText(bookId: string, chapter: number, narrated: boolean) {
  const [data, setData] = useState<ReaderChapterData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void getReaderChapter(bookId, chapter).then((d) => {
      if (!alive) return;
      if (d) setData(d);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [bookId, chapter, narrated]);

  return { data: data && data.chapter === chapter ? data : null, failed };
}
