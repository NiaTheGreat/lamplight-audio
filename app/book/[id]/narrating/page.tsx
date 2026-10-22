"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, StateGlyph } from "@/components/Icon";
import { STALE_MS, USD_PER_MILLION_CHARS, usePlayer } from "@/components/PlayerProvider";
import { Ticks } from "@/components/Ticks";

const LABELS = {
  ready: "Ready",
  playing: "Playing",
  reading: "Reading aloud",
  waiting: "Waiting",
  failed: "Couldn't be read aloud",
} as const;

export default function Narrating() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const p = usePlayer();
  const { book, selectBook } = p;
  const [missing, setMissing] = useState(false);
  // Which chapters to read in the background (0-based, inclusive).
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const rangeTouched = useRef(false);

  useEffect(() => {
    let alive = true;
    void selectBook(id).then((b) => alive && setMissing(!b));
    return () => {
      alive = false;
    };
  }, [id, selectBook]);

  const bookForRange = book && book.id === id ? book : null;
  const firstWaiting = bookForRange
    ? Math.max(0, bookForRange.chapters.findIndex((c) => !["ready", "playing"].includes(p.chapterState(c.index))))
    : 0;
  useEffect(() => {
    if (!bookForRange) return;
    if (!rangeTouched.current) {
      setRange({ from: firstWaiting, to: bookForRange.chapters.length - 1 });
    }
  }, [bookForRange, firstWaiting]);

  if (missing) {
    return (
      <main className="screen no-tabs">
        <p className="empty">That book isn&apos;t stored any more. Add the EPUB again to bring it back.</p>
        <Link href="/add" className="btn primary">Add a fic</Link>
      </main>
    );
  }
  if (!book || book.id !== id) {
    return <main className="screen no-tabs"><p className="empty">Opening…</p></main>;
  }

  const total = book.chapters.length;
  const running = p.job?.status === "running";
  const stalled = running && p.job ? Date.now() - p.job.updatedAt > STALE_MS : false;
  const failedHere = p.job?.status === "error" ? p.job.chapter : null;
  const sel = range ?? { from: 0, to: total - 1 };
  const inRange = (i: number) => i >= sel.from && i <= sel.to;
  const notReady = (i: number) => !["ready", "playing"].includes(p.chapterState(i));
  const rangeChars = book.chapters
    .filter((c) => inRange(c.index) && notReady(c.index))
    .reduce((sum, c) => sum + c.chars, 0);
  const rangeToDo = book.chapters.filter((c) => inRange(c.index) && notReady(c.index)).length;
  const cost = ((rangeChars * USD_PER_MILLION_CHARS) / 1_000_000).toFixed(2);
  const done = p.readyCount >= total;
  const wholeBook = sel.from === 0 && sel.to === total - 1;
  const runFrom = p.job?.from ?? 0;
  const runTo = p.job?.to ?? total - 1;

  const lead = done
    ? "The whole book is ready to listen to."
    : stalled
      ? "Narration looks stalled. You can pick it back up."
      : running && p.job
        ? `Chapter ${Math.min(p.job.chapter + 1, total)} is being read now${runFrom > 0 || runTo < total - 1 ? ` (chapters ${runFrom + 1} to ${runTo + 1})` : ""}. You can close this page; it will keep going.`
        : p.readyCount > 0
          ? `${p.readyCount} of ${total} chapters are ready. The rest are read aloud when you play them, or all at once below.`
          : "Nothing has been read aloud yet. It happens when you press play, or all at once below.";

  return (
    <main className="screen no-tabs" style={{ paddingBottom: 140 }}>
      <div className="topbar">
        <Link href="/" className="icon-btn" aria-label="Back to shelf"><Icon name="back" /></Link>
      </div>

      <div className="eyebrow" style={{ marginTop: 6 }}>Being read aloud</div>
      <h1 className="title" style={{ marginTop: 6 }}>{book.title}</h1>
      <div className="muted" style={{ marginTop: 6 }}>
        {book.author ? `${book.author} · ` : ""}{total} chapters
      </div>

      <p className="lead" style={{ marginTop: 22 }}>{lead}</p>
      <div style={{ marginTop: 18 }}><Ticks
          done={p.readyCount}
          total={total}
          big
          ready={book.chapters.filter((c) => !notReady(c.index)).map((c) => c.index)}
        /></div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }} className="faint">
        <span>{p.readyCount} of {total} ready</span>
        {!done ? <span>About ${cost} to read the rest</span> : null}
      </div>
      {p.error ? <p className="error" role="alert">{p.error}</p> : null}
      {p.job?.status === "error" ? (
        <p className="error" role="alert">Narration stopped: {p.job.error}</p>
      ) : null}

      {!running && !done ? (
        <section className="section" aria-label="Which chapters to read">
          <div className="eyebrow">Which chapters</div>
          <div className="rangepick">
            <label>
              <span className="faint">From</span>
              <select
                className="select wide"
                value={sel.from}
                onChange={(e) => {
                  rangeTouched.current = true;
                  const from = Number(e.target.value);
                  setRange({ from, to: Math.max(from, sel.to) });
                }}
              >
                {book.chapters.map((c) => (
                  <option key={c.index} value={c.index}>{c.index + 1}. {c.title}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="faint">To</span>
              <select
                className="select wide"
                value={sel.to}
                onChange={(e) => {
                  rangeTouched.current = true;
                  const to = Number(e.target.value);
                  setRange({ from: Math.min(sel.from, to), to });
                }}
              >
                {book.chapters.map((c) => (
                  <option key={c.index} value={c.index}>{c.index + 1}. {c.title}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {rangeToDo === 0
              ? "Everything in this range is already read aloud."
              : `${rangeToDo} chapter${rangeToDo === 1 ? "" : "s"} to read, about $${cost}. Chapters before ${sel.from + 1} stay unread, so nothing is spent on them.`}
          </p>
        </section>
      ) : null}

      <div className="rows" style={{ marginTop: 20 }}>
        {book.chapters.map((c) => {
          const state = p.chapterState(c.index);
          const label =
            state === "reading" && p.preparing?.chapter === c.index
              ? `Reading aloud · ${p.preparing.pct}%`
              : LABELS[state];
          return (
            <div
              key={c.index}
              className={`chrow ${state} ${!running && !inRange(c.index) ? "outside" : ""}`}
            >
              <StateGlyph state={state} />
              <span className="nm">{c.title}</span>
              <span className="st">{label}</span>
            </div>
          );
        })}
      </div>

      <div className="sticky-actions">
        <button
          className="btn primary"
          onClick={() => {
            router.push(`/book/${book.id}`);
            void p.openBook(book.id);
          }}
        >
          <Icon name="play" size={20} />Start listening
        </button>
        {running && !stalled ? (
          <button className="btn" onClick={() => void p.stopBackground()}>Stop</button>
        ) : !done ? (
          <button
            className="btn"
            disabled={rangeToDo === 0 && failedHere === null && !stalled}
            onClick={() => void p.startBackground(failedHere !== null || stalled ? { from: runFrom, to: runTo } : sel)}
          >
            {failedHere !== null || stalled
              ? "Resume"
              : wholeBook
                ? "Read it all"
                : sel.from === sel.to
                  ? `Read chapter ${sel.from + 1}`
                  : `Read ${sel.from + 1} to ${sel.to + 1}`}
          </button>
        ) : null}
      </div>
    </main>
  );
}
