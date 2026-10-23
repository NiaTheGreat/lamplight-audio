"use client";

import { useEffect, type RefObject } from "react";
import type { BookSummary } from "@/lib/types";

/** Lock-screen / headphone controls and the "now playing" card. */
export function useMediaSession({
  audioRef,
  book,
  chapter,
  prevChapter,
  nextChapter,
  skip,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  book: BookSummary | null;
  chapter: number;
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
    ms.setActionHandler("play", () => void audio?.play());
    ms.setActionHandler("pause", () => audio?.pause());
    ms.setActionHandler("previoustrack", () => prevChapter());
    ms.setActionHandler("nexttrack", () => nextChapter());
    ms.setActionHandler("seekbackward", () => skip(-15));
    ms.setActionHandler("seekforward", () => skip(15));
  }, [audioRef, book, chapter, prevChapter, nextChapter, skip]);
}
