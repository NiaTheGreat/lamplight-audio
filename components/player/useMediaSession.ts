"use client";

import { useEffect, type RefObject } from "react";
import type { BookSummary } from "@/lib/types";

/** Lock-screen / headphone controls and the "now playing" card. */
export function useMediaSession({
  audioRef,
  book,
  chapter,
  playing,
  resume,
  prevChapter,
  nextChapter,
  skip,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  book: BookSummary | null;
  chapter: number;
  playing: boolean;
  resume: () => void;
  prevChapter: () => void;
  nextChapter: () => void;
  skip: (delta: number) => void;
}) {
  useEffect(() => {
    if (!book || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: book.chapters[chapter]?.title ?? `Chapter ${chapter + 1}`,
      artist: book.author ?? "",
      album: book.title,
    });
    const audio = audioRef.current;
    ms.setActionHandler("play", () => resume());
    ms.setActionHandler("pause", () => audio?.pause());
    ms.setActionHandler("previoustrack", () => prevChapter());
    ms.setActionHandler("nexttrack", () => nextChapter());
    ms.setActionHandler("seekbackward", () => skip(-15));
    ms.setActionHandler("seekforward", () => skip(15));
  }, [audioRef, book, chapter, resume, prevChapter, nextChapter, skip]);

  // Keep the lock screen's play/pause button in step with the real state.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);
}
