"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, PlayDot, StateGlyph } from "@/components/Icon";
import { STALE_MS, usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { estimateMs, formatEta, type SpeedStats } from "@/lib/eta";
import { startingPoint } from "@/lib/listening";
import { costUsd, formatUsd, narratorLabel, PRICE_PER_MILLION_CHARS, providerOf } from "@/lib/narrators-shared";
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
  const [speed, setSpeed] = useState<SpeedStats>({});
  useEffect(() => {
    fetch("/api/speed").then((r) => (r.ok ? r.json() : {})).then(setSpeed).catch(() => {});
  }, []);
  const groups = useNarrators();
  const [narratorError, setNarratorError] = useState("");
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
  const paused = p.job?.status === "paused";
  const failedHere = p.job?.status === "error" ? p.job.chapter : null;
  const sel = range ?? { from: 0, to: total - 1 };
  const inRange = (i: number) => i >= sel.from && i <= sel.to;
  const notReady = (i: number) => !["ready", "playing"].includes(p.chapterState(i));
  const rangeChars = book.chapters
    .filter((c) => inRange(c.index) && notReady(c.index))
    .reduce((sum, c) => sum + c.chars, 0);
  const rangeToDo = book.chapters.filter((c) => inRange(c.index) && notReady(c.index)).length;
  const cost = costUsd(rangeChars, book.voice).toFixed(2);
  const eta = formatEta(estimateMs(rangeChars, speed[providerOf(book.voice)]));
  const canChangeNarrator = p.readyCount === 0 && !running && !paused;
  const done = p.readyCount >= total;
  const wholeBook = sel.from === 0 && sel.to === total - 1;
  const runFrom = p.job?.from ?? 0;
  const runTo = p.job?.to ?? total - 1;

  const lead = done
    ? "The whole book is ready to listen to."
    : stalled
      ? "Narration looks stalled. You can pick it back up."
      : paused && p.job
        ? `Paused before chapter ${Math.min(p.job.chapter + 1, total)}. Nothing more is spent until you continue.`
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
        {!done ? <span>About ${cost} · {eta}</span> : null}
      </div>
      {p.error ? <p className="error" role="alert">{p.error}</p> : null}
      {p.job?.status === "error" ? (
        <p className="error" role="alert">Narration stopped: {p.job.error}</p>
      ) : null}

      <Link href={`/book/${book.id}/pronunciation`} className="btn" style={{ marginTop: 18 }}>
        How to say names and words
      </Link>

      <section className="section" aria-label="Narrator">
        <div className="eyebrow">Narrator</div>
        {canChangeNarrator ? (
          <select
            className="select wide"
            aria-label="Narrator"
            value={book.voice ?? ""}
            onChange={async (e) => {
              setNarratorError("");
              const res = await fetch(`/api/books/${book.id}/narrator`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ narrator: e.target.value }),
              });
              if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as { error?: string };
                setNarratorError(data.error ?? "Couldn't change the narrator.");
                return;
              }
              await p.refreshBook(book.id);
              await p.refreshLibrary();
            }}
          >
            {groups.map((g) => (
              <optgroup key={g.provider} label={`${g.label} · about ${formatUsd(g.pricePerMillion)} per million characters`}>
                {g.narrators.map((n) => (
                  <option key={n.id} value={n.id} disabled={!g.configured && n.id !== book.voice}>
                    {n.label}
                    {g.configured ? "" : " (needs a key)"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <div style={{ fontSize: 17 }} className="serif">
            {narratorLabel(book.voice)}
            <span className="faint"> · about {formatUsd(PRICE_PER_MILLION_CHARS[providerOf(book.voice)])} per million characters</span>
          </div>
        )}
        {narratorError ? <p className="error" role="alert">{narratorError}</p> : null}
        <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
          {canChangeNarrator
            ? "You can change the narrator until the first chapter is narrated. After that this fic keeps it."
            : "This fic keeps its narrator, so a half-listened story never changes voice."}
          {!done && rangeToDo > 0
            ? ` For this range: about ${formatUsd(costUsd(rangeChars, "ballad"))} with OpenAI, ${formatUsd(costUsd(rangeChars, "deepinfra:kokoro:af_bella"))} with Kokoro.`
            : ""}
        </p>
      </section>

      {!running && !paused && !done ? (
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
              className={`chrow ${state} ${!running && !inRange(c.index) && state !== "ready" ? "outside" : ""}`}
            >
              {state === "ready" ? (
                <button
                  className="play-area"
                  aria-label={`Play ${c.title}`}
                  onClick={() => {
                    router.push(`/book/${book.id}`);
                    void p.openBook(book.id, { chapter: c.index, time: 0, range: null });
                  }}
                >
                  <PlayDot />
                  <span className="nm">{c.title}</span>
                  <span className="st">{label}</span>
                </button>
              ) : (
                <>
                  <StateGlyph state={state} />
                  <span className="nm">{c.title}</span>
                  <span className="st">{label}</span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky-actions">
        <button
          className="btn primary"
          onClick={() => {
            // Start where the chosen range starts (not chapter 1), and keep narrating inside it.
            const start = startingPoint({
              rangeTouched: rangeTouched.current,
              rangeFrom: sel.from,
              saved: p.progress.books[book.id],
              chapterCount: total,
            });
            router.push(`/book/${book.id}`);
            void p.openBook(book.id, {
              chapter: start.chapter,
              time: start.time,
              range: rangeTouched.current && !wholeBook ? sel : null,
            });
          }}
        >
          <Icon name="play" size={20} />Start listening
        </button>
        {running && !stalled ? (
          <>
            <button className="btn" onClick={() => void p.pauseBackground()}>Pause</button>
            <button className="btn" onClick={() => void p.stopBackground()}>Cancel</button>
          </>
        ) : paused ? (
          <>
            <button className="btn" onClick={() => void p.resumeBackground()}>Continue</button>
            <button className="btn" onClick={() => void p.stopBackground()}>Cancel</button>
          </>
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
