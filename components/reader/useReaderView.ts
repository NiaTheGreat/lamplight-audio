"use client";

import { useCallback, useEffect, useState } from "react";
import { readStore, writeStore } from "@/components/player/store";
import { getReaderStatus } from "@/lib/client/reader";

export const VIEW_KEY = "abg:view";
/** "book" is the book on its own (no player); "read" is the Listen | Read side with the audio. */
export type View = "listen" | "read" | "book";

/**
 * Whether the book screen offers the reader, and which side is showing. Off (the server's
 * READER_ENABLED=false, or the status call failing) always means the listening screen.
 */
export function useReaderView(bookId: string) {
  const [enabled, setEnabled] = useState(false);
  const [hasEpub, setHasEpub] = useState(false);
  const [view, setViewState] = useState<View>("listen");
  const [viewLoaded, setViewLoaded] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getReaderStatus(bookId);
    setEnabled(s.enabled);
    setHasEpub(s.hasEpub);
    setStatusLoaded(true);
  }, [bookId]);

  useEffect(() => {
    void refresh();
    const saved = readStore<View>(VIEW_KEY, "listen");
    setViewState(saved === "read" || saved === "book" ? saved : "listen");
    setViewLoaded(true);
  }, [refresh]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    writeStore(VIEW_KEY, v);
  }, []);

  // Known which screen to show. Only the book-only view has to wait for the server's answer
  // (whether the reader is on), so the listening screen never does.
  const ready = viewLoaded && (view !== "book" || statusLoaded);

  return { enabled, hasEpub, ready, view: enabled ? view : ("listen" as View), setView, refresh };
}

export type ReaderView = ReturnType<typeof useReaderView>;
