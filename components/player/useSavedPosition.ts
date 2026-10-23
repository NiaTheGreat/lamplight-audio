"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import type { BookSummary } from "@/lib/types";
import { POSITION_KEY, writeStore } from "./store";
import type { Progress } from "./types";

/**
 * Where the listener is in each book: saved on this device and on the server (at most every
 * 30 s while playing, always on pause, chapter change and when the page goes away).
 */
export function useSavedPosition({
  audioRef,
  bookRef,
  chapterRef,
  loadedRef,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  bookRef: MutableRefObject<BookSummary | null>;
  chapterRef: MutableRefObject<number>;
  loadedRef: MutableRefObject<string>;
}) {
  const lastSaved = useRef(0);
  const [progress, setProgress] = useState<Progress>({ last: null, books: {} });

  const savePosition = useCallback((force = false) => {
    const audio = audioRef.current;
    const b = bookRef.current;
    // Nothing has been played yet (just browsing a book): don't record a position.
    if (!audio || !b || !loadedRef.current || audio.src.startsWith("data:")) return;
    const now = Date.now();
    if (!force && now - lastSaved.current < 30000) return;
    lastSaved.current = now;
    const pos = { id: b.id, chapter: chapterRef.current, time: Math.floor(audio.currentTime) };
    writeStore(POSITION_KEY, pos);
    fetch("/api/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pos),
      keepalive: true,
    })
      .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
      .then((p) => p && setProgress(p))
      .catch(() => {});
  }, [audioRef, bookRef, chapterRef, loadedRef]);

  // Save the place when the page goes away.
  useEffect(() => {
    const save = () => savePosition(true);
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [savePosition]);

  return { progress, setProgress, savePosition };
}
