"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { afterChapter, inRange, needsConfirm, shouldPrefetch, type ListenRange } from "@/lib/listening";
import { costUsd } from "@/lib/narrators-shared";
import { DEFAULT_SETTINGS, SPEEDS, type Settings } from "@/lib/settings-shared";
import type { BookSummary, LibraryEntry } from "@/lib/types";
import {
  AUTONEXT_KEY,
  CONFIRM_KEY,
  CPM_KEY,
  DIM_LEVELS,
  POSITION_KEY,
  RANGE_KEY,
  SILENT_WAV,
  readStore,
  writeStore,
} from "./player/store";
import type {
  ChapterState,
  JobInfo,
  OpenOptions,
  PendingNarration,
  Position,
  Progress,
  Sleep,
} from "./player/types";

export { STALE_MS } from "./player/types";
export type { ChapterState, JobInfo, OpenOptions, PendingNarration, Position, Progress, Sleep };

type Ctx = {
  // Playback
  book: BookSummary | null;
  chapter: number;
  playing: boolean;
  position: number;
  duration: number;
  preparing: { chapter: number; pct: number } | null;
  error: string;
  failedChapter: number | null;
  rate: number;
  sleep: Sleep;
  autoNext: boolean;
  charsPerMin: number;
  // Library
  library: LibraryEntry[];
  libraryLoaded: boolean;
  libraryError: string;
  progress: Progress;
  // Background narration
  job: JobInfo | null;
  // Settings and display
  settings: Settings;
  dim: number;
  bedside: boolean;
  // Actions
  selectBook: (id: string) => Promise<BookSummary | null>;
  openBook: (id: string, opts?: OpenOptions) => Promise<void>;
  confirmNarrate: boolean;
  setConfirmNarrate: (on: boolean) => void;
  pendingNarration: PendingNarration | null;
  confirmNarration: () => void;
  cancelNarration: () => void;
  playChapter: (index: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  cycleRate: () => void;
  cycleSleep: () => void;
  setSleepMinutes: (minutes: number) => void;
  cycleDim: () => void;
  setBedside: (on: boolean) => void;
  setAutoNext: (on: boolean) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshBook: (id: string) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  startBackground: (range?: { from: number; to: number }, voice?: string) => Promise<void>;
  stopBackground: () => Promise<void>;
  /** Throw away a narrated chapter and narrate it again now (stopping it if it's playing). Returns an error message, or null. */
  rereadAndNarrate: (
    bookId: string,
    index: number,
    opts: { listId?: string; voice?: string; voiceForBook?: boolean },
  ) => Promise<string | null>;
  /** Throw away several narrated chapters and narrate exactly those again in the background. Returns an error message, or null. */
  rereadMany: (
    bookId: string,
    indices: number[],
    opts: { listId?: string; voice?: string; voiceForBook?: boolean },
  ) => Promise<string | null>;
  pauseBackground: () => Promise<void>;
  resumeBackground: () => Promise<void>;
  chapterState: (index: number) => ChapterState;
  readyCount: number;
  chapterMinutes: (chars: number) => number;
};

const PlayerContext = createContext<Ctx | null>(null);

export function usePlayer(): Ctx {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onLogin = pathname === "/login";

  const audioRef = useRef<HTMLAudioElement>(null);
  const bookRef = useRef<BookSummary | null>(null);
  const chapterRef = useRef(0);
  const loadedRef = useRef(""); // "<bookId>:<chapter>" whose audio is on the element
  const resumeAtRef = useRef(0);
  const rateRef = useRef(1);
  const rateTouched = useRef(false);
  const autoNextRef = useRef(true);
  const confirmRef = useRef(true);
  const listenRangeRef = useRef<ListenRange>(null);
  const pendingRef = useRef<PendingNarration | null>(null);
  const loadToken = useRef(0);
  const lastSaved = useRef(0);
  const readyRef = useRef(new Set<string>());
  const sleepRef = useRef<Sleep>({ kind: "off" });
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);

  const [book, setBook] = useState<BookSummary | null>(null);
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [preparing, setPreparing] = useState<{ chapter: number; pct: number } | null>(null);
  const [error, setError] = useState("");
  const [failedChapter, setFailedChapter] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [sleep, setSleepState] = useState<Sleep>({ kind: "off" });
  const [autoNext, setAutoNextState] = useState(true);
  const [confirmNarrate, setConfirmNarrateState] = useState(true);
  const [pendingNarration, setPendingState] = useState<PendingNarration | null>(null);
  const [charsPerMin, setCharsPerMin] = useState(900);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [progress, setProgress] = useState<Progress>({ last: null, books: {} });
  const [job, setJob] = useState<JobInfo | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [dim, setDim] = useState(DEFAULT_SETTINGS.dim);
  const [bedside, setBedside] = useState(false);
  const [, setReadyTick] = useState(0);

  const bumpReady = () => setReadyTick((n) => n + 1);

  // ---------- Narration requests ----------

  // Ask the server to narrate a chapter. Long chapters come back 202 with
  // progress; each retry resumes where the last one stopped.
  const prepare = useCallback(
    async (
      b: BookSummary,
      index: number,
      onProgress?: (ready: number, total: number) => void,
      cancelled: () => boolean = () => false,
    ) => {
      // The generate request is silent until it finishes, so ask separately
      // how many chunks are cached so far.
      const timer = onProgress
        ? setInterval(async () => {
            try {
              const r = await fetch(`/api/audio/${b.id}/${index}?progress=1`);
              if (r.ok && !cancelled()) {
                const p = (await r.json()) as { ready: number; total: number };
                onProgress(p.ready, p.total);
              }
            } catch {
              /* progress is best-effort */
            }
          }, 2000)
        : undefined;
      try {
        for (;;) {
          const res = await fetch(`/api/audio/${b.id}/${index}?prepare=1`);
          if (cancelled()) return false;
          if (res.status === 202) {
            const p = (await res.json()) as { ready: number; total: number };
            onProgress?.(p.ready, p.total);
            continue;
          }
          if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
          readyRef.current.add(`${b.id}:${index}`);
          bumpReady();
          return true;
        }
      } finally {
        clearInterval(timer);
      }
    },
    [],
  );

  /**
   * Narrate a chapter through the background job system, then wait for it: the server does the
   * work whether or not this tab stays open, and it shows in the Queue. If a job is already
   * running for the book (or the job can't be started), narrate directly as before.
   */
  const prepareViaQueue = useCallback(
    async (
      b: BookSummary,
      index: number,
      onProgress: (ready: number, total: number) => void,
      cancelled: () => boolean,
    ): Promise<boolean> => {
      let started = false;
      try {
        const res = await fetch(`/api/books/${b.id}/narrate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapters: [index], onlyIfIdle: true }),
        });
        started = res.ok;
      } catch {
        /* narrate directly instead */
      }
      if (!started) return prepare(b, index, onProgress, cancelled);

      let lastJobCheck = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled()) {
          // They moved on: stop the work we started, so it doesn't keep spending.
          void fetch(`/api/books/${b.id}/narrate`, { method: "DELETE" }).catch(() => {});
          return false;
        }
        try {
          const r = await fetch(`/api/audio/${b.id}/${index}?progress=1`);
          if (r.ok) {
            const p = (await r.json()) as { ready: number; total: number };
            onProgress(p.ready, p.total);
            if (p.total > 0 && p.ready >= p.total) {
              readyRef.current.add(`${b.id}:${index}`);
              bumpReady();
              return true;
            }
          }
          // Every few seconds, check the job itself so a failure shows up instead of waiting forever.
          if (Date.now() - lastJobCheck > 6000) {
            lastJobCheck = Date.now();
            const j = await fetch(`/api/books/${b.id}/narrate`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
            if (j && j.status === "error") throw new Error(j.error ?? "Narration failed.");
            if (j && j.status === "cancelled") return false;
          }
        } catch (err) {
          if (err instanceof Error && err.message && !/fetch|network/i.test(err.message)) throw err;
          /* a dropped request: look again next time round */
        }
      }
    },
    [prepare],
  );

  const isReadyIdx = (b: BookSummary, i: number) =>
    readyRef.current.has(`${b.id}:${i}`) || Boolean(b.narrated?.includes(i));

  const setPending = (p: PendingNarration | null) => {
    pendingRef.current = p;
    setPendingState(p);
  };

  const setListenRange = (bookId: string, range: ListenRange) => {
    listenRangeRef.current = range;
    writeStore(`${RANGE_KEY}:${bookId}`, range);
  };

  const prefetch = useCallback(
    (b: BookSummary, index: number) => {
      // Only narrate ahead inside the chapters the listener chose.
      if (
        !shouldPrefetch({
          index,
          count: b.chapters.length,
          autoNext: autoNextRef.current,
          range: listenRangeRef.current,
        })
      ) {
        return;
      }
      if (readyRef.current.has(`${b.id}:${index}`)) return;
      if (b.narrated?.includes(index)) {
        readyRef.current.add(`${b.id}:${index}`);
        return;
      }
      prepare(b, index).catch(() => {});
    },
    [prepare],
  );

  // ---------- Library, progress, settings ----------

  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      if (res.ok) {
        setLibrary((await res.json()) as LibraryEntry[]);
        setLibraryLoaded(true);
        setLibraryError("");
      } else {
        setLibraryError(`Couldn't load your shelf (${res.status}). ${(await res.text()).slice(0, 200)}`);
      }
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  const refreshBook = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/books/${id}`);
      if (!res.ok) return;
      const fresh = (await res.json()) as BookSummary;
      if (bookRef.current?.id !== id) return;
      bookRef.current = fresh;
      setBook(fresh);
    } catch {
      /* try again next tick */
    }
  }, []);

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
  }, []);

  useEffect(() => {
    if (onLogin) return;
    setCharsPerMin(readStore<number>(CPM_KEY, 900));
    const savedAuto = readStore<boolean>(AUTONEXT_KEY, true);
    autoNextRef.current = savedAuto;
    const savedConfirm = readStore<boolean>(CONFIRM_KEY, true);
    confirmRef.current = savedConfirm;
    setConfirmNarrateState(savedConfirm);
    setAutoNextState(savedAuto);

    void refreshLibrary();
    fetch("/api/progress")
      .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
      .then((p) => p && setProgress(p))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => (r.ok ? (r.json() as Promise<Settings>) : null))
      .then((s) => {
        if (!s) return;
        settingsRef.current = s;
        setSettings(s);
        setDim(s.dim);
        if (!rateTouched.current) {
          rateRef.current = s.speed;
          setRate(s.speed);
        }
      })
      .catch(() => {});
  }, [onLogin, refreshLibrary]);

  // ---------- Playback ----------

  const setSleep = useCallback((value: Sleep) => {
    sleepRef.current = value;
    setSleepState(value);
  }, []);

  const setSleepMinutes = useCallback(
    (minutes: number) => {
      if (minutes === 0) setSleep({ kind: "off" });
      else if (minutes === -1) setSleep({ kind: "chapter" });
      else setSleep({ kind: "minutes", minutes, endsAt: Date.now() + minutes * 60_000 });
    },
    [setSleep],
  );

  const applyRate = useCallback((value: number) => {
    rateRef.current = value;
    setRate(value);
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = value;
      audio.playbackRate = value;
    }
  }, []);

  const startChapter = useCallback(
    async (b: BookSummary, index: number, startAt = 0, fresh = false) => {
      const audio = audioRef.current;
      if (!audio) return;
      const token = ++loadToken.current;

      bookRef.current = b;
      chapterRef.current = index;
      setBook(b);
      setChapter(index);
      setPosition(startAt);
      setDuration(0);
      setError("");
      setFailedChapter(null);
      setPreparing({ chapter: index, pct: 0 });

      // Unlock audio playback while we still have the user's tap.
      audio.src = SILENT_WAV;
      loadedRef.current = "";
      audio.play().catch(() => {});

      // A chapter that is already narrated needs no preparing: one request plays it.
      if (!isReadyIdx(b, index)) {
        try {
          const ok = await prepareViaQueue(
            b,
            index,
            (ready, total) => {
              if (token === loadToken.current) {
                setPreparing({ chapter: index, pct: Math.round((ready / total) * 100) });
              }
            },
            () => token !== loadToken.current,
          );
          if (!ok || token !== loadToken.current) return;
        } catch (err) {
          if (token !== loadToken.current) return;
          audio.pause();
          setPreparing(null);
          setFailedChapter(index);
          setError(err instanceof Error ? err.message : "Couldn't prepare that chapter.");
          return;
        }
      }
      if (token !== loadToken.current) return;

      audio.src = `/api/audio/${b.id}/${index}`;
      loadedRef.current = `${b.id}:${index}`;
      audio.defaultPlaybackRate = rateRef.current;
      audio.playbackRate = rateRef.current;
      if (startAt > 0) audio.currentTime = startAt;
      audio.play().catch(() => {});
      setPreparing(null);

      // The saved default sleep timer starts with a fresh listen, not on auto-advance.
      if (fresh && sleepRef.current.kind === "off" && settingsRef.current.sleep !== 0) {
        setSleepMinutes(settingsRef.current.sleep);
      }
      savePosition(true);
      prefetch(b, index + 1);
    },
    [prefetch, prepareViaQueue, savePosition, setSleepMinutes],
  );

  const selectBook = useCallback(
    async (id: string): Promise<BookSummary | null> => {
      if (bookRef.current?.id === id) return bookRef.current;
      try {
        const res = await fetch(`/api/books/${id}`);
        if (!res.ok) return null;
        const b = (await res.json()) as BookSummary;
        const audio = audioRef.current;
        if (audio && !audio.paused) audio.pause();
        const saved = progress.books[id];
        const index = saved && b.chapters[saved.chapter] ? saved.chapter : 0;
        bookRef.current = b;
        listenRangeRef.current = readStore<ListenRange>(`${RANGE_KEY}:${id}`, null);
        chapterRef.current = index;
        resumeAtRef.current = saved && b.chapters[saved.chapter] ? saved.time : 0;
        loadedRef.current = "";
        loadToken.current++;
        setBook(b);
        setChapter(index);
        setPosition(resumeAtRef.current);
        setDuration(0);
        setPlaying(false);
        setPreparing(null);
        setError("");
        setFailedChapter(null);
        setJob(null);
        return b;
      } catch {
        return null;
      }
    },
    [progress],
  );

  /**
   * Start a chapter because the listener asked to. If it isn't narrated yet, ask first
   * (it costs money), unless they turned the prompt off.
   */
  const requestStart = useCallback(
    async (b: BookSummary, index: number, startAt: number, fresh: boolean) => {
      const ch = b.chapters[index];
      if (ch && needsConfirm({ isReady: isReadyIdx(b, index), confirmSetting: confirmRef.current })) {
        setPending({
          bookId: b.id,
          index,
          startAt,
          fresh,
          title: ch.title,
          chars: ch.chars,
          costUsd: costUsd(ch.chars, b.voice),
          narrator: b.voice,
        });
        return;
      }
      await startChapter(b, index, startAt, fresh);
    },
    [startChapter],
  );

  const confirmNarration = useCallback(() => {
    const p = pendingRef.current;
    const b = bookRef.current;
    setPending(null);
    if (p && b && b.id === p.bookId) void startChapter(b, p.index, p.startAt, p.fresh);
  }, [startChapter]);

  const cancelNarration = useCallback(() => setPending(null), []);

  const openBook = useCallback(
    async (id: string, opts?: OpenOptions) => {
      // Already loaded: just carry on rather than restarting the chapter.
      if (
        bookRef.current?.id === id &&
        loadedRef.current &&
        (opts?.chapter === undefined || opts.chapter === chapterRef.current)
      ) {
        audioRef.current?.play().catch(() => {});
        return;
      }
      const b = await selectBook(id);
      if (!b) return;
      if (opts?.range !== undefined) setListenRange(id, opts.range);
      if (opts?.chapter !== undefined && b.chapters[opts.chapter]) {
        chapterRef.current = opts.chapter;
        resumeAtRef.current = opts.time ?? 0;
        setChapter(opts.chapter);
      }
      await requestStart(b, chapterRef.current, resumeAtRef.current, true);
    },
    [selectBook, requestStart],
  );

  const playChapter = useCallback(
    async (index: number) => {
      const b = bookRef.current;
      if (!b || !b.chapters[index]) return;
      // Choosing a chapter outside the chosen range means they want to read from there.
      if (!inRange(listenRangeRef.current, index)) setListenRange(b.id, null);
      await requestStart(b, index, 0, true);
    },
    [requestStart],
  );

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    const b = bookRef.current;
    if (!audio || !b) return;
    if (preparing) return;
    if (loadedRef.current !== `${b.id}:${chapterRef.current}`) {
      await requestStart(b, chapterRef.current, resumeAtRef.current, true);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [preparing, requestStart]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (loadedRef.current) audio.currentTime = seconds;
    else resumeAtRef.current = seconds;
    setPosition(Math.floor(seconds));
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio || !loadedRef.current) return;
      const target = Math.max(0, Math.min(audio.currentTime + delta, audio.duration || Infinity));
      seek(target);
    },
    [seek],
  );

  const nextChapter = useCallback(() => {
    const b = bookRef.current;
    if (b && chapterRef.current < b.chapters.length - 1) void requestStart(b, chapterRef.current + 1, 0, false);
  }, [requestStart]);

  const prevChapter = useCallback(() => {
    const b = bookRef.current;
    const audio = audioRef.current;
    if (!b) return;
    // Like a CD player: within the first few seconds go back a chapter, otherwise restart it.
    if (audio && loadedRef.current && audio.currentTime > 5) {
      seek(0);
      return;
    }
    if (chapterRef.current > 0) void requestStart(b, chapterRef.current - 1, 0, false);
  }, [seek, requestStart]);

  const cycleRate = useCallback(() => {
    rateTouched.current = true;
    const i = SPEEDS.findIndex((s) => Math.abs(s - rateRef.current) < 0.01);
    applyRate(SPEEDS[(i + 1) % SPEEDS.length]);
  }, [applyRate]);

  const cycleSleep = useCallback(() => {
    const order = [0, 15, 30, 60, -1];
    const cur = sleepRef.current;
    const curVal = cur.kind === "off" ? 0 : cur.kind === "chapter" ? -1 : cur.minutes;
    const i = order.indexOf(curVal);
    setSleepMinutes(order[(i + 1) % order.length]);
  }, [setSleepMinutes]);

  const cycleDim = useCallback(() => {
    setDim((d) => {
      const i = DIM_LEVELS.findIndex((l) => l > d);
      return i === -1 ? DIM_LEVELS[0] : DIM_LEVELS[i];
    });
  }, []);

  const setConfirmNarrate = useCallback((on: boolean) => {
    confirmRef.current = on;
    setConfirmNarrateState(on);
    writeStore(CONFIRM_KEY, on);
  }, []);

  const setAutoNext = useCallback(
    (on: boolean) => {
      autoNextRef.current = on;
      setAutoNextState(on);
      writeStore(AUTONEXT_KEY, on);
      // Turning it on mid-chapter should start the next one right away.
      const b = bookRef.current;
      if (on && b) prefetch(b, chapterRef.current + 1);
    },
    [prefetch],
  );

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (patch.dim !== undefined) setDim(patch.dim);
    if (patch.speed !== undefined && !rateTouched.current) {
      rateRef.current = patch.speed;
      setRate(patch.speed);
    }
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (res.ok) {
        const saved = (await res.json()) as Settings;
        settingsRef.current = saved;
        setSettings(saved);
      }
    } catch {
      /* keep the optimistic value */
    }
  }, []);

  const removeBook = useCallback(
    async (id: string) => {
      // Unload it first, or the player's background refresh would put it back.
      if (bookRef.current?.id === id) {
        audioRef.current?.pause();
        loadToken.current++;
        bookRef.current = null;
        loadedRef.current = "";
        setBook(null);
        setPlaying(false);
        setPreparing(null);
        setJob(null);
      }
      await fetch(`/api/books/${id}`, { method: "DELETE" }).catch(() => {});
      await refreshLibrary();
    },
    [refreshLibrary],
  );

  // ---------- Background narration job ----------

  const startBackground = useCallback(async (range?: { from: number; to: number }, voice?: string) => {
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
  }, []);

  const stopBackground = useCallback(async () => {
    const b = bookRef.current;
    if (!b) return;
    await fetch(`/api/books/${b.id}/narrate`, { method: "DELETE" }).catch(() => {});
    setJob(null);
  }, []);

  const actOnJob = useCallback(async (action: "pause" | "resume") => {
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
  }, []);
  const rereadAndNarrate = useCallback(
    async (
      bookId: string,
      index: number,
      opts: { listId?: string; voice?: string; voiceForBook?: boolean },
    ): Promise<string | null> => {
      const res = await fetch(`/api/books/${bookId}/reread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter: index, ...opts }),
      }).catch(() => null);
      if (!res) return "Couldn't reach the server.";
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return data.error ?? "Couldn't do that.";
      }
      readyRef.current.delete(`${bookId}:${index}`);
      void refreshLibrary();
      const fresh = await fetch(`/api/books/${bookId}`).catch(() => null);
      if (!fresh || !fresh.ok) return "Re-read, but couldn't reload the book. Open it to narrate.";
      // Starting the chapter replaces whatever is playing, so the old narration stops here. Not
      // awaited: narrating takes minutes, and the form closes now; progress shows in the player.
      void startChapter((await fresh.json()) as BookSummary, index, 0, true);
      return null;
    },
    [refreshLibrary, startChapter],
  );

  const rereadMany = useCallback(
    async (
      bookId: string,
      indices: number[],
      opts: { listId?: string; voice?: string; voiceForBook?: boolean },
    ): Promise<string | null> => {
      const json = { "Content-Type": "application/json" };
      const re = await fetch(`/api/books/${bookId}/reread`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ chapters: indices, ...opts }),
      }).catch(() => null);
      if (!re) return "Couldn't reach the server.";
      if (!re.ok) return ((await re.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't do that.";
      const run = await fetch(`/api/books/${bookId}/narrate`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ chapters: indices }),
      }).catch(() => null);
      for (const i of indices) readyRef.current.delete(`${bookId}:${i}`);
      void refreshLibrary();
      if (bookRef.current?.id === bookId) void refreshBook(bookId);
      if (!run || !run.ok) {
        const data = (await run?.json().catch(() => ({}))) as { error?: string } | undefined;
        return `The chapters were cleared, but narrating didn't start: ${data?.error ?? "try \"Read it all\" or play them."}`;
      }
      if (bookRef.current?.id === bookId) setJob((await run.json()) as JobInfo);
      return null;
    },
    [refreshBook, refreshLibrary],
  );

  const pauseBackground = useCallback(() => actOnJob("pause"), [actOnJob]);
  const resumeBackground = useCallback(() => actOnJob("resume"), [actOnJob]);

  const bookId = book?.id;
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

  // ---------- Audio element events ----------

  const isSilent = () => Boolean(audioRef.current?.src.startsWith("data:"));

  function onTimeUpdate() {
    const audio = audioRef.current;
    if (!audio || isSilent()) return;
    const t = Math.floor(audio.currentTime);
    setPosition((p) => (p === t ? p : t));
    const s = sleepRef.current;
    if (s.kind === "minutes" && Date.now() >= s.endsAt) {
      audio.pause();
      setSleep({ kind: "off" });
    }
    savePosition();
  }

  function onLoadedMetadata() {
    const audio = audioRef.current;
    if (!audio || isSilent()) return;
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    // Learn how fast the narrator really talks, so the minutes in the chapter
    // list match the audio.
    const ch = bookRef.current?.chapters[chapterRef.current];
    if (ch && Number.isFinite(audio.duration) && audio.duration >= 30) {
      const measured = Math.round(ch.chars / (audio.duration / 60));
      setCharsPerMin(measured);
      writeStore(CPM_KEY, measured);
    }
  }

  function onEnded() {
    // The silent unlock clip also ends; that must not count as a finished chapter.
    if (isSilent()) return;
    const audio = audioRef.current;
    const b = bookRef.current;
    if (!audio || !b) return;
    setPlaying(false);

    if (sleepRef.current.kind === "chapter") {
      setSleep({ kind: "off" });
      return;
    }
    const next = chapterRef.current + 1;
    const decision = afterChapter({
      next,
      count: b.chapters.length,
      isReady: isReadyIdx(b, next),
      autoNext: autoNextRef.current,
      range: listenRangeRef.current,
    });
    if (decision === "stop") return;
    // A chapter the listener asked for but that isn't narrated yet: wait for it rather than playing a 202.
    if (decision === "narrate") {
      void startChapter(b, next, 0, false);
      return;
    }
    // Prefetched: swap straight over so lock-screen playback keeps going.
    chapterRef.current = next;
    loadedRef.current = `${b.id}:${next}`;
    setChapter(next);
    setPosition(0);
    setDuration(0);
    audio.src = `/api/audio/${b.id}/${next}`;
    audio.defaultPlaybackRate = rateRef.current;
    audio.playbackRate = rateRef.current;
    audio.play().catch(() => {});
    savePosition(true);
    prefetch(b, next + 1);
  }

  // Lock-screen / headphone controls.
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
  }, [book, chapter, prevChapter, nextChapter, skip]);

  // Save the place when the page goes away.
  useEffect(() => {
    const save = () => savePosition(true);
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [savePosition]);

  // ---------- Derived ----------

  const chapterMinutes = useCallback(
    (chars: number) => Math.max(1, Math.round(chars / charsPerMin)),
    [charsPerMin],
  );

  const isChapterReady = (index: number) =>
    Boolean(book && (readyRef.current.has(`${book.id}:${index}`) || book.narrated?.includes(index)));

  const chapterState = (index: number): ChapterState => {
    if (!book) return "waiting";
    if (index === chapter && playing && isChapterReady(index)) return "playing";
    if (failedChapter === index || (job?.status === "error" && job.chapter === index)) return "failed";
    if (preparing?.chapter === index) return "reading";
    if (isChapterReady(index)) return "ready";
    if (job?.status === "running" && job.chapter === index) return "reading";
    return "waiting";
  };

  const readyCount = book ? book.chapters.filter((c) => isChapterReady(c.index)).length : 0;

  const value: Ctx = {
    book,
    chapter,
    playing,
    position,
    duration,
    preparing,
    error,
    failedChapter,
    rate,
    sleep,
    autoNext,
    charsPerMin,
    library,
    libraryLoaded,
    libraryError,
    progress,
    job,
    settings,
    dim,
    bedside,
    selectBook,
    openBook,
    confirmNarrate,
    setConfirmNarrate,
    pendingNarration,
    confirmNarration,
    cancelNarration,
    playChapter,
    togglePlay,
    seek,
    skip,
    nextChapter,
    prevChapter,
    cycleRate,
    cycleSleep,
    setSleepMinutes,
    cycleDim,
    setBedside,
    setAutoNext,
    updateSettings,
    refreshLibrary,
    refreshBook,
    removeBook,
    startBackground,
    stopBackground,
    pauseBackground,
    resumeBackground,
    rereadAndNarrate,
    rereadMany,
    chapterState,
    readyCount,
    chapterMinutes,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={() => {
          const a = audioRef.current;
          if (a && !isSilent() && Number.isFinite(a.duration)) setDuration(a.duration);
        }}
        onPlay={() => !isSilent() && setPlaying(true)}
        onPause={() => {
          if (!isSilent()) {
            setPlaying(false);
            savePosition(true);
          }
        }}
        onEnded={onEnded}
        className="hidden-input"
      />
    </PlayerContext.Provider>
  );
}
