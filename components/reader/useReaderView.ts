"use client";

import { useCallback, useEffect, useState } from "react";
import { readStore, writeStore } from "@/components/player/store";
import { getReaderStatus } from "@/lib/client/reader";

export const VIEW_KEY = "abg:view";
export type View = "listen" | "read";

/**
 * Whether the book screen offers the reader, and which side is showing. Off (the server's
 * READER_ENABLED=false, or the status call failing) always means the listening screen.
 */
export function useReaderView(bookId: string) {
  const [enabled, setEnabled] = useState(false);
  const [hasEpub, setHasEpub] = useState(false);
  const [view, setViewState] = useState<View>("listen");

  const refresh = useCallback(async () => {
    const s = await getReaderStatus(bookId);
    setEnabled(s.enabled);
    setHasEpub(s.hasEpub);
  }, [bookId]);

  useEffect(() => {
    void refresh();
    setViewState(readStore<View>(VIEW_KEY, "listen") === "read" ? "read" : "listen");
  }, [refresh]);

  const setView = useCallback((v: View) => {
    setViewState(v);
    writeStore(VIEW_KEY, v);
  }, []);

  return { enabled, hasEpub, view: enabled ? view : ("listen" as View), setView, refresh };
}

export type ReaderView = ReturnType<typeof useReaderView>;
