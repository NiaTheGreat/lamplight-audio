"use client";

import { useCallback, useState } from "react";
import type { LibraryEntry } from "@/lib/types";

/** The shelf: every book with which chapters are narrated. Kept when offline. */
export function useLibrary() {
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState("");

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      if (res.ok) {
        setLibrary((await res.json()) as LibraryEntry[]);
        setLibraryLoaded(true);
        setLibraryError("");
      } else {
        setLibraryError(
          `Couldn't load your shelf (${res.status}). ${(await res.text()).slice(0, 200)}`,
        );
      }
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  return { library, libraryLoaded, libraryError, refreshLibrary };
}
