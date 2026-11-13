"use client";

import { useEffect, useRef } from "react";
import { saveReading } from "@/lib/client/api";

/**
 * Tell the server which chapter is open in the reader, and when its end has been reached, so Browse
 * can show Unread / Reading / Finished. Quiet on failure: reading never depends on it.
 */
export function useReadingProgress(bookId: string, chapter: number, total: number, atEnd: boolean) {
  const sentOpen = useRef("");
  const sentEnd = useRef("");

  useEffect(() => {
    if (!bookId || total <= 0) return;
    const key = `${bookId}:${chapter}`;
    if (sentOpen.current === key) return;
    // A short wait, so flicking through chapters doesn't save every one.
    const t = setTimeout(() => {
      sentOpen.current = key;
      void saveReading({ id: bookId, chapter, total });
    }, 1500);
    return () => clearTimeout(t);
  }, [bookId, chapter, total]);

  useEffect(() => {
    if (!bookId || total <= 0 || !atEnd) return;
    const key = `${bookId}:${chapter}`;
    if (sentEnd.current === key) return;
    sentEnd.current = key;
    void saveReading({ id: bookId, chapter, total, done: true });
  }, [bookId, chapter, total, atEnd]);
}
