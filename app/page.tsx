"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BookSummary } from "@/lib/types";

type Recent = { id: string; title: string };
type Last = { id: string; chapter: number; time: number };

const RECENT_KEY = "abg:recent";
const LAST_KEY = "abg:last";
const RATE_KEY = "abg:rate";

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
  const loadToken = useRef(0);
  const lastSaved = useRef(0);

  const [book, setBook] = useState<BookSummary | null>(null);
  const [chapter, setChapter] = useState(0);
  const [skipNotes, setSkipNotes] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  const [rate, setRate] = useState(1);

  const prefetch = useCallback((b: BookSummary, index: number) => {
    if (index >= b.chapters.length) return;
    // Asking for one byte makes the server narrate and cache the next chapter.
    fetch(`/api/audio/${b.id}/${index}`, { headers: { Range: "bytes=0-0" } }).catch(() => {});
  }, []);

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
      setStatus(`Preparing chapter ${index + 1}… the first time can take a minute.`);

      // Unlock audio playback while we still have the user's tap.
      audio.src = SILENT_WAV;
      audio.play().catch(() => {});

      try {
        const res = await fetch(`/api/audio/${b.id}/${index}`, {
          headers: { Range: "bytes=0-0" },
        });
        if (token !== loadToken.current) return;
        if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      } catch (err) {
        if (token !== loadToken.current) return;
        setStatus("");
        setError(err instanceof Error ? err.message : "Couldn't prepare that chapter.");
        return;
      }

      audio.src = `/api/audio/${b.id}/${index}`;
      audio.defaultPlaybackRate = rateRef.current;
      audio.playbackRate = rateRef.current;
      if (startAt > 0) audio.currentTime = startAt;
      audio.play().catch(() => {});
      setStatus("");
      writeStore(LAST_KEY, { id: b.id, chapter: index, time: startAt } satisfies Last);
      prefetch(b, index + 1);
    },
    [prefetch],
  );

  // iOS only allows audio to start from a tap. Playing a silent clip during the
  // tap "unlocks" the element so we can start the real audio after the server
  // finishes preparing it.
  function unlockAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = SILENT_WAV;
    audio.play().catch(() => {});
  }

  const rememberBook = useCallback((b: BookSummary) => {
    setRecent((prev) => {
      const next = [{ id: b.id, title: b.title }, ...prev.filter((r) => r.id !== b.id)].slice(0, 8);
      writeStore(RECENT_KEY, next);
      return next;
    });
  }, []);

  // Restore saved state on first load.
  useEffect(() => {
    setRecent(readStore<Recent[]>(RECENT_KEY, []));
    const savedRate = readStore<number>(RATE_KEY, 1);
    setRate(savedRate);
    rateRef.current = savedRate;

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
  }, []);

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
      rememberBook(data);
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
    void startChapter(b, 0);
  }

  function onEnded() {
    const b = bookRef.current;
    if (!b) return;
    const next = chapterRef.current + 1;
    if (next >= b.chapters.length) return;
    // Straight to the (already prefetched) next chapter.
    const audio = audioRef.current;
    if (!audio) return;
    chapterRef.current = next;
    setChapter(next);
    audio.src = `/api/audio/${b.id}/${next}`;
    audio.defaultPlaybackRate = rateRef.current;
    audio.playbackRate = rateRef.current;
    audio.play().catch(() => {});
    writeStore(LAST_KEY, { id: b.id, chapter: next, time: 0 } satisfies Last);
    prefetch(b, next + 1);
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
        {error ? <p className="error">{error}</p> : null}
      </form>

      {!book && recent.length > 0 ? (
        <section className="panel recent">
          <h2>Recent</h2>
          {recent.map((r) => (
            <button key={r.id} className="ghost" onClick={() => void openRecent(r)}>
              {r.title}
            </button>
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

        <audio ref={audioRef} controls preload="none" onEnded={onEnded} onTimeUpdate={onTimeUpdate} />

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
                  <span className="muted">{Math.max(1, Math.round(c.chars / 900))} min</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </main>
  );
}
