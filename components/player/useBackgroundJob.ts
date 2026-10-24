"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import type { BookSummary } from "@/lib/types";
import type { JobInfo } from "./types";

/**
 * The background narration job of the open book: its status (polled, slowly when idle) and
 * the start / stop / pause / resume actions.
 */
export function useBackgroundJob({
  bookRef,
  bookId,
  onLogin,
  setError,
  refreshBook,
  refreshLibrary,
}: {
  bookRef: MutableRefObject<BookSummary | null>;
  bookId: string | undefined;
  onLogin: boolean;
  setError: (message: string) => void;
  refreshBook: (id: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
}) {
  const [job, setJob] = useState<JobInfo | null>(null);

  const startBackground = useCallback(
    async (range?: { from: number; to: number }, voice?: string) => {
      const b = bookRef.current;
      if (!b) return;
      setError("");
      const res = await fetch(`/api/books/${b.id}/narrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(range ?? {}), ...(voice ? { voice } : {}) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Couldn't start background narration.");
        return;
      }
      setJob((await res.json()) as JobInfo);
    },
    [bookRef, setError],
  );

  const stopBackground = useCallback(async () => {
    const b = bookRef.current;
    if (!b) return;
    await fetch(`/api/books/${b.id}/narrate`, { method: "DELETE" }).catch(() => {});
    setJob(null);
  }, [bookRef]);

  const actOnJob = useCallback(
    async (action: "pause" | "resume") => {
      const b = bookRef.current;
      if (!b) return;
      setError("");
      const res = await fetch(`/api/books/${b.id}/narrate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).catch(() => null);
      if (!res || !res.ok) {
        const data = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
        setError(data?.error ?? `Couldn't ${action} narration.`);
        return;
      }
      setJob((await res.json()) as JobInfo | null);
    },
    [bookRef, setError],
  );

  const pauseBackground = useCallback(() => actOnJob("pause"), [actOnJob]);
  const resumeBackground = useCallback(() => actOnJob("resume"), [actOnJob]);

  useEffect(() => {
    if (!bookId || onLogin) return;
    let alive = true;
    let lastStatus: string | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let delay = 30_000; // idle: look rarely
      try {
        const res = await fetch(`/api/books/${bookId}/narrate`);
        if (!res.ok || !alive) return;
        const j = (await res.json()) as JobInfo | null;
        setJob(j);
        // Refresh the book and shelf only while a job runs and once when it changes state.
        if (j?.status === "running") delay = 15_000;
        if (j && (j.status === "running" || j.status !== lastStatus)) {
          void refreshBook(bookId);
          void refreshLibrary();
        }
        lastStatus = j?.status;
      } catch {
        /* try again next tick */
      } finally {
        if (alive) timer = setTimeout(poll, delay);
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [bookId, onLogin, refreshBook, refreshLibrary]);

  return { job, setJob, startBackground, stopBackground, pauseBackground, resumeBackground };
}
