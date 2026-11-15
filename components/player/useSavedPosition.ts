"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { BookSummary } from "@/lib/types";
import { newerPosition, POS_KEY } from "./position";
import { POSITION_KEY, readStore, writeStore } from "./store";
import type { Position, Progress } from "./types";

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
  // Where each chapter was left, kept here too so a quick return doesn't wait for the server.
  const spots = useRef(new Map<string, number>());
  const toClear = useRef<number | null>(null);
  const [progress, setProgressState] = useState<Progress>({ last: null, books: {} });
  // The newest progress from the server, readable the moment it arrives (state is a render behind).
  const progressRef = useRef<Progress>(progress);
  const setProgress = useCallback((p: Progress) => {
    progressRef.current = p;
    setProgressState(p);
  }, []);

  /** The saved place for a book: the newer of the server's and this device's copy. */
  const savedPlace = useCallback(
    (bookId: string): Position | null =>
      newerPosition(
        progressRef.current.books[bookId],
        readStore<Position | null>(POS_KEY(bookId), null),
      ),
    [],
  );

  const savePosition = useCallback(
    (force = false) => {
      const audio = audioRef.current;
      const b = bookRef.current;
      // Nothing has been played yet (just browsing a book): don't record a position.
      if (!audio || !b || !loadedRef.current || audio.src.startsWith("data:")) return;
      const now = Date.now();
      if (!force && now - lastSaved.current < 30000) return;
      lastSaved.current = now;
      const pos = { id: b.id, chapter: chapterRef.current, time: Math.floor(audio.currentTime) };
      const clear = toClear.current;
      toClear.current = null;
      if (clear !== pos.chapter) spots.current.set(`${b.id}:${pos.chapter}`, pos.time);
      // This device's own copy, read back when the server's is missing or behind.
      const at = Date.now();
      const chapters: Record<string, number> = { ...savedPlace(b.id)?.chapters };
      for (const [k, v] of spots.current) {
        if (k.startsWith(`${b.id}:`)) chapters[k.slice(b.id.length + 1)] = v;
      }
      if (typeof clear === "number") delete chapters[String(clear)];
      writeStore(POSITION_KEY, pos);
      writeStore(POS_KEY(b.id), { chapter: pos.chapter, time: pos.time, updatedAt: at, chapters });
      fetch("/api/progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clear === null ? { ...pos, at } : { ...pos, at, clear }),
        keepalive: true,
      })
        .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
        .then((p) => p && setProgress(p))
        .catch(() => {});
    },
    [audioRef, bookRef, chapterRef, loadedRef, savedPlace, setProgress],
  );

  /** Where to pick a chapter up: its own saved spot, or 0 if it was never started or finished. */
  const spotFor = useCallback(
    (bookId: string, index: number) =>
      spots.current.get(`${bookId}:${index}`) ?? savedPlace(bookId)?.chapters?.[index] ?? 0,
    [savedPlace],
  );

  /** The chapter was listened to the end; the next save drops its spot. */
  const finishChapter = useCallback((bookId: string, index: number) => {
    spots.current.set(`${bookId}:${index}`, 0);
    toClear.current = index;
  }, []);

  // Save the place when the page goes away. iOS often skips `pagehide` when an app is swiped away
  // or the phone locks, so a page that is hidden while playing saves too.
  useEffect(() => {
    const save = () => savePosition(true);
    const onHide = () => {
      if (document.visibilityState === "hidden" && audioRef.current?.paused === false) save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [savePosition, audioRef]);

  return { progress, progressRef, setProgress, savedPlace, savePosition, spotFor, finishChapter };
}
