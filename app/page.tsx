"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookSummary } from "@/lib/types";

type Recent = { id: string; title: string; author?: string; chapterCount: number };
type Last = { id: string; chapter: number; time: number };

const LAST_KEY = "abg:last";
const CPM_KEY = "abg:cpm";
const RATE_KEY = "abg:rate";
const AUTONEXT_KEY = "abg:autonext";

// Rough all-in narration cost: gpt-4o-mini-tts is ~$0.015/min and tts-1 is $15 per
// million characters. Both land near $15-17 per million characters of text.
const USD_PER_MILLION_CHARS = 16;

// A silent clip played on the first tap so iOS lets us start audio later,
// after the (possibly slow) first-time narration finishes.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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

export default function Home() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const bookRef = useRef<BookSummary | null>(null);
  const chapterRef = useRef(0);
  const rateRef = useRef(1);
  const autoNextRef = useRef(true);
  const [autoNext, setAutoNext] = useState(true);
  const loadToken = useRef(0);
  const lastSaved = useRef(0);

  const [book, setBook] = useState<BookSummary | null>(null);
  const [chapter, setChapter] = useState(0);
  const [skipNotes, setSkipNotes] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [rate, setRate] = useState(1);
  const [bulk, setBulk] = useState<{ chapter: number; total: number; pct: number } | null>(null);
  const bulkToken = useRef(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [charsPerMin, setCharsPerMin] = useState(900);

  // Ask the server to narrate a chapter. Long chapters come back 202 with
  // progress; each retry resumes where the last one stopped.
  const readyRef = useRef(new Set<string>());
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
          const res = await fetch(`/api/audio/${b.id}/${index}`, {
            headers: { Range: "bytes=0-0" },
          });
          if (cancelled()) return false;
          if (res.status === 202) {
            const p = (await res.json()) as { ready: number; total: number };
            onProgress?.(p.ready, p.total);
            continue;
          }
          if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
          readyRef.current.add(`${b.id}:${index}`);
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
      prepare(b, index).catch(() => {});
    },
    [prepare],
  );

  const startChapter = useCallback(
    async (b: BookSummary, index: number, startAt = 0) => {
      const audio = audioRef.current;
      if (!audio) return;
      const token = ++loadToken.current;

      bookRef.current = b;
      chapterRef.current = index;
      setBook(b);
      setChapter(index);
      setError("");
      setProgress(0);
      setStatus(`Preparing chapter ${index + 1}… the first time can take a minute.`);

      // Unlock audio playback while we still have the user's tap.
      audio.src = SILENT_WAV;
      audio.play().catch(() => {});

      try {
        const ok = await prepare(
          b,
          index,
          (ready, total) => {
            if (token === loadToken.current) {
              const pct = Math.round((ready / total) * 100);
              setProgress(pct);
              setStatus(`Preparing chapter ${index + 1}… ${pct}%`);
            }
          },
          () => token !== loadToken.current,
        );
        if (!ok || token !== loadToken.current) return;
      } catch (err) {
        if (token !== loadToken.current) return;
        setStatus("");
        setProgress(null);
        setError(err instanceof Error ? err.message : "Couldn't prepare that chapter.");
        return;
      }

      audio.src = `/api/audio/${b.id}/${index}`;
      audio.defaultPlaybackRate = rateRef.current;
      audio.playbackRate = rateRef.current;
      if (startAt > 0) audio.currentTime = startAt;
      audio.play().catch(() => {});
      setStatus("");
      setProgress(null);
      writeStore(LAST_KEY, { id: b.id, chapter: index, time: startAt } satisfies Last);
      prefetch(b, index + 1);
    },
    [prefetch, prepare],
  );

  // Narrate every chapter in order so the whole book is ready to play instantly.
  // Runs while this page stays open; chapters already cached are skipped fast.
  async function prepareAll(b: BookSummary) {
    const token = ++bulkToken.current;
    const cancelled = () => token !== bulkToken.current;
    setError("");
    try {
      for (let i = 0; i < b.chapters.length; i++) {
        if (cancelled()) return;
        setBulk({ chapter: i + 1, total: b.chapters.length, pct: 0 });
        const ok = await prepare(
          b,
          i,
          (ready, total) =>
            !cancelled() &&
            setBulk({ chapter: i + 1, total: b.chapters.length, pct: Math.round((ready / total) * 100) }),
          cancelled,
        );
        if (!ok) return;
      }
    } catch (err) {
      if (!cancelled()) setError(err instanceof Error ? err.message : "Couldn't prepare the book.");
    } finally {
      if (!cancelled()) setBulk(null);
    }
  }

  function toggleAutoNext(on: boolean) {
    autoNextRef.current = on;
    setAutoNext(on);
    writeStore(AUTONEXT_KEY, on);
    // Turning it on mid-chapter should start the next one right away.
    const b = bookRef.current;
    if (on && b) prefetch(b, chapterRef.current + 1);
  }

  function stopPrepareAll() {
    bulkToken.current++;
    setBulk(null);
  }

  // iOS only allows audio to start from a tap. Playing a silent clip during the
  // tap "unlocks" the element so we can start the real audio after the server
  // finishes preparing it.
  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
  }

  // The library lives on the server (Blob in production), so it follows you
  // across devices and survives clearing the browser.
  const refreshLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/books");
      if (res.ok) setRecent((await res.json()) as Recent[]);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  // Restore saved state on first load.
  useEffect(() => {
    void refreshLibrary();
    setCharsPerMin(readStore<number>(CPM_KEY, 900));
    const savedRate = readStore<number>(RATE_KEY, 1);
    setRate(savedRate);
    rateRef.current = savedRate;
    const savedAuto = readStore<boolean>(AUTONEXT_KEY, true);
    autoNextRef.current = savedAuto;
    setAutoNext(savedAuto);

    const last = readStore<Last | null>(LAST_KEY, null);
    if (!last) return;
    fetch(`/api/books/${last.id}`)
      .then((res) => (res.ok ? (res.json() as Promise<BookSummary>) : null))
      .then((b) => {
        if (!b) return;
        bookRef.current = b;
        chapterRef.current = last.chapter;
        setBook(b);
        setChapter(last.chapter);
        const audio = audioRef.current;
        if (audio && b.chapters[last.chapter]) {
          audio.src = `/api/audio/${b.id}/${last.chapter}`;
          audio.currentTime = last.time;
        }
      })
      .catch(() => {});
  }, [refreshLibrary]);

  // Lock-screen / headphone controls.
  useEffect(() => {
    if (!book || !("mediaSession" in navigator)) return;
    const audio = audioRef.current;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: book.chapters[chapter]?.title ?? `Chapter ${chapter + 1}`,
      artist: book.author ?? "",
      album: book.title,
    });
    navigator.mediaSession.setActionHandler("play", () => void audio?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      if (chapter > 0) void startChapter(book, chapter - 1);
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      if (chapter < book.chapters.length - 1) void startChapter(book, chapter + 1);
    });
  }, [book, chapter, startChapter]);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      setError("Choose an EPUB file first.");
      return;
    }
    setError("");
    setStatus("Reading your EPUB…");
    unlockAudio();
    const form = new FormData();
    form.append("file", file);
    form.append("skipNotes", String(skipNotes));
    try {
      const res = await fetch("/api/books", { method: "POST", body: form });
      const data = (await res.json()) as BookSummary & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't read that EPUB.");
      void refreshLibrary();
      void startChapter(data, 0);
    } catch (err) {
      setStatus("");
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  async function openRecent(r: Recent) {
    setError("");
    unlockAudio();
    const res = await fetch(`/api/books/${r.id}`);
    if (!res.ok) {
      setError("That book is no longer stored. Upload the EPUB again.");
      return;
    }
    const b = (await res.json()) as BookSummary;
    // Pick up where you left off if this is the book you were last listening to.
    const last = readStore<Last | null>(LAST_KEY, null);
    const resume = last && last.id === b.id && b.chapters[last.chapter] ? last : null;
    void startChapter(b, resume?.chapter ?? 0, resume?.time ?? 0);
  }

  async function removeBook(r: Recent) {
    if (!window.confirm(`Remove "${r.title}" from your library? Narration already made is kept.`)) return;
    await fetch(`/api/books/${r.id}`, { method: "DELETE" }).catch(() => {});
    void refreshLibrary();
  }

  function onEnded() {
    // The silent unlock clip also ends; that must not count as a finished chapter.
    if (audioRef.current?.src.startsWith("data:")) return;
    const b = bookRef.current;
    if (!b) return;
    const next = chapterRef.current + 1;
    if (next >= b.chapters.length) return;
    const audio = audioRef.current;
    if (!audio) return;
    // With auto-narrate off, only roll straight on into a chapter that's ready.
    if (!autoNextRef.current && !readyRef.current.has(`${b.id}:${next}`)) return;
    // A very long chapter may still be narrating; wait for it rather than
    // playing a 202.
    if (!readyRef.current.has(`${b.id}:${next}`)) {
      void startChapter(b, next);
      return;
    }
    // Prefetched: swap straight over so lock-screen playback keeps going.
    chapterRef.current = next;
    setChapter(next);
    audio.src = `/api/audio/${b.id}/${next}`;
    audio.defaultPlaybackRate = rateRef.current;
    audio.playbackRate = rateRef.current;
    audio.play().catch(() => {});
    writeStore(LAST_KEY, { id: b.id, chapter: next, time: 0 } satisfies Last);
    prefetch(b, next + 1);
  }

  // Learn how fast the narrator really talks, so the minutes in the chapter
  // list match the audio.
  function onLoadedMetadata() {
    const audio = audioRef.current;
    const b = bookRef.current;
    const ch = b?.chapters[chapterRef.current];
    if (!audio || !ch || !Number.isFinite(audio.duration) || audio.duration < 30) return;
    const measured = Math.round(ch.chars / (audio.duration / 60));
    setCharsPerMin(measured);
    writeStore(CPM_KEY, measured);
  }

  function onTimeUpdate() {
    const audio = audioRef.current;
    const b = bookRef.current;
    if (!audio || !b) return;
    const now = Date.now();
    if (now - lastSaved.current < 5000) return;
    lastSaved.current = now;
    writeStore(LAST_KEY, {
      id: b.id,
      chapter: chapterRef.current,
      time: Math.floor(audio.currentTime),
    } satisfies Last);
  }

  function changeRate(value: number) {
    setRate(value);
    rateRef.current = value;
    writeStore(RATE_KEY, value);
    const audio = audioRef.current;
    if (audio) {
      audio.defaultPlaybackRate = value;
      audio.playbackRate = value;
    }
  }

  const totalChars = book?.chapters.reduce((sum, c) => sum + c.chars, 0) ?? 0;
  const estimate = ((totalChars * USD_PER_MILLION_CHARS) / 1_000_000).toFixed(2);

  return (
    <main>
      <h1>Audiobook Generator</h1>

      <form className="panel" onSubmit={onUpload}>
        <input type="file" name="file" accept=".epub,application/epub+zip" />
        <label className="check">
          <input
            type="checkbox"
            checked={skipNotes}
            onChange={(e) => setSkipNotes(e.target.checked)}
          />
          Skip author&apos;s notes and summaries
        </label>
        <button type="submit">Convert &amp; play</button>
        {status ? <p className="status">{status}</p> : null}
        {progress !== null ? (
          <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </form>

      {recent.length > 0 ? (
        <section className="panel recent">
          <h2>Your library</h2>
          {recent.map((r) => (
            <div className="row" key={r.id}>
              <button className="ghost grow" onClick={() => void openRecent(r)}>
                {r.title}
                {r.author ? ` · ${r.author}` : ""} · {r.chapterCount} ch
              </button>
              <button className="ghost" aria-label={`Remove ${r.title}`} onClick={() => void removeBook(r)}>
                ✕
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel" hidden={!book}>
        <h2>{book?.title}</h2>
        {book?.author ? <p className="muted">{book.author}</p> : null}
        {book ? (
          <p className="muted">
            {book.chapters.length} chapters · about ${estimate} to narrate everything the first
            time. Replays are free because audio is cached.
          </p>
        ) : null}

        {book ? (
          <label className="check">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => toggleAutoNext(e.target.checked)}
            />
            Narrate the next chapter while I listen, and play it automatically
          </label>
        ) : null}

        {book ? (
          bulk ? (
            <>
              <p className="status">
                Preparing chapter {bulk.chapter} of {bulk.total}… keep this page open.
              </p>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(((bulk.chapter - 1 + bulk.pct / 100) / bulk.total) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.max(4, ((bulk.chapter - 1 + bulk.pct / 100) / bulk.total) * 100)}%` }} />
              </div>
              <button type="button" className="ghost" onClick={stopPrepareAll}>
                Stop preparing
              </button>
            </>
          ) : (
            <button type="button" className="ghost" onClick={() => void prepareAll(book)}>
              Prepare all chapters now (about ${estimate})
            </button>
          )
        ) : null}

        <audio ref={audioRef} controls preload="none" onEnded={onEnded} onLoadedMetadata={onLoadedMetadata} onTimeUpdate={onTimeUpdate} />

        <div className="row">
          <button
            className="ghost"
            disabled={!book || chapter === 0}
            onClick={() => book && void startChapter(book, chapter - 1)}
          >
            ← Prev
          </button>
          <button
            className="ghost"
            disabled={!book || chapter >= (book?.chapters.length ?? 1) - 1}
            onClick={() => book && void startChapter(book, chapter + 1)}
          >
            Next →
          </button>
          <select
            aria-label="Playback speed"
            value={rate}
            onChange={(e) => changeRate(Number(e.target.value))}
          >
            {[0.8, 1, 1.1, 1.25, 1.5, 1.75, 2].map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
          {book ? (
            <a className="btn ghost" href={`/api/audio/${book.id}/${chapter}?download=1`} download>
              Download MP3
            </a>
          ) : null}
        </div>
      </section>

      {book ? (
        <section className="panel">
          <h2>Chapters</h2>
          <ol className="chapters">
            {book.chapters.map((c) => (
              <li key={c.index} className={c.index === chapter ? "active" : undefined}>
                <button onClick={() => void startChapter(book, c.index)}>
                  <span>{c.title}</span>
                  <span className="muted">{Math.max(1, Math.round(c.chars / charsPerMin))} min</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
