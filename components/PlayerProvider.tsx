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
import { DEFAULT_SETTINGS, SPEEDS, type Settings } from "@/lib/settings-shared";
import type { BookSummary, LibraryEntry } from "@/lib/types";

export type JobInfo = {
  status: "running" | "done" | "cancelled" | "error";
  chapter: number;
  total: number;
  updatedAt: number;
  error?: string;
};
// A running job that hasn't saved progress for this long has probably lost its worker.
export const STALE_MS = 8 * 60 * 1000;

export type Position = { chapter: number; time: number; updatedAt: number };
export type Progress = { last: ({ id: string } & Position) | null; books: Record<string, Position> };
export type ChapterState = "ready" | "reading" | "waiting" | "playing" | "failed";
export type Sleep = { kind: "off" } | { kind: "chapter" } | { kind: "minutes"; endsAt: number; minutes: number };

const CPM_KEY = "abg:cpm";
const AUTONEXT_KEY = "abg:autonext";
const POSITION_KEY = "abg:last";
const DIM_LEVELS = [0, 25, 50, 80];

// A silent clip played on the first tap so iOS lets us start audio later,
// after the (possibly slow) first-time narration finishes.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

// Rough all-in narration cost: gpt-4o-mini-tts is ~$0.015/min and tts-1 is $15 per
// million characters. Both land near $15-17 per million characters of text.
export const USD_PER_MILLION_CHARS = 16;

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; fine */
  }
}

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
  openBook: (id: string) => Promise<void>;
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
  removeBook: (id: string) => Promise<void>;
  startBackground: () => Promise<void>;
  stopBackground: () => Promise<void>;
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

  const prefetch = useCallback(
    (b: BookSummary, index: number) => {
      if (index >= b.chapters.length || !autoNextRef.current) return;
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
    if (!force && now - lastSaved.current < 15000) return;
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

      try {
        const ok = await prepare(
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
    [prefetch, prepare, savePosition, setSleepMinutes],
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

  const openBook = useCallback(
    async (id: string) => {
      // Already loaded: just carry on rather than restarting the chapter.
      if (bookRef.current?.id === id && loadedRef.current) {
        audioRef.current?.play().catch(() => {});
        return;
      }
      const b = await selectBook(id);
      if (!b) return;
      await startChapter(b, chapterRef.current, resumeAtRef.current, true);
    },
    [selectBook, startChapter],
  );

  const playChapter = useCallback(
    async (index: number) => {
      const b = bookRef.current;
      if (!b || !b.chapters[index]) return;
      await startChapter(b, index, 0, true);
    },
    [startChapter],
  );

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    const b = bookRef.current;
    if (!audio || !b) return;
    if (preparing) return;
    if (loadedRef.current !== `${b.id}:${chapterRef.current}`) {
      await startChapter(b, chapterRef.current, resumeAtRef.current, true);
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, [preparing, startChapter]);

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
    if (b && chapterRef.current < b.chapters.length - 1) void startChapter(b, chapterRef.current + 1, 0, false);
  }, [startChapter]);

  const prevChapter = useCallback(() => {
    const b = bookRef.current;
    const audio = audioRef.current;
    if (!b) return;
    // Like a CD player: within the first few seconds go back a chapter, otherwise restart it.
    if (audio && loadedRef.current && audio.currentTime > 5) {
      seek(0);
      return;
    }
    if (chapterRef.current > 0) void startChapter(b, chapterRef.current - 1, 0, false);
  }, [seek, startChapter]);

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

  const startBackground = useCallback(async () => {
    const b = bookRef.current;
    if (!b) return;
    setError("");
    const res = await fetch(`/api/books/${b.id}/narrate`, { method: "POST" });
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

  const bookId = book?.id;
  useEffect(() => {
    if (!bookId || onLogin) return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/books/${bookId}/narrate`);
        if (!res.ok || !alive) return;
        const j = (await res.json()) as JobInfo | null;
        setJob(j);
        if (j?.status === "running" || j?.status === "done") {
          void refreshBook(bookId);
          void refreshLibrary();
        }
      } catch {
        /* try again next tick */
      }
    };
    void poll();
    const timer = setInterval(poll, 6000);
    return () => {
      alive = false;
      clearInterval(timer);
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
    if (next >= b.chapters.length) return;
    const isReady = readyRef.current.has(`${b.id}:${next}`) || b.narrated?.includes(next);
    // With auto-narrate off, only roll straight on into a chapter that's ready.
    if (!autoNextRef.current && !isReady) return;
    // A very long chapter may still be narrating; wait for it rather than playing a 202.
    if (!isReady) {
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
    removeBook,
    startBackground,
    stopBackground,
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
