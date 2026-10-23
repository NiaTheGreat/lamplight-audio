"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Icon, PlayDot, StateGlyph } from "@/components/Icon";
import { STALE_MS, usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { estimateMs, formatEta, type SpeedStats } from "@/lib/eta";
import { startingPoint } from "@/lib/listening";
import { changeNarrator, getSpeed, repairChapter } from "@/lib/client/api";
import { NarratorOptions } from "@/components/NarratorOptions";
import { costUsd, formatUsd, narratorLabel, PRICE_PER_MILLION_CHARS, PROVIDER_INFO, providerOf } from "@/lib/narrators-shared";
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
  const dialog = useDialog();
  const { book, selectBook } = p;
  const [missing, setMissing] = useState(false);
  const [repairMsg, setRepairMsg] = useState("");
  // "" = the fic's own voice. Only used for the batch started with the Read button.
  const [batchVoice, setBatchVoice] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // Once a job has started for the chosen chapters, leave selecting mode.
  const jobActive = p.job?.status === "running" || p.job?.status === "paused";
  useEffect(() => {
    if (jobActive) {
      setSelecting(false);
      setPicked(new Set());
    }
  }, [jobActive]);
  const [speed, setSpeed] = useState<SpeedStats>({});
  useEffect(() => {
    void getSpeed().then(setSpeed);
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
  const jobRunning = p.job?.status === "running";
  // A job whose worker has gone quiet isn't really running: the chapter pickers must stay usable.
  const stalled = jobRunning && p.job ? Date.now() - p.job.updatedAt > STALE_MS : false;
  const running = jobRunning && !stalled;
  const paused = p.job?.status === "paused";
  const failedHere = p.job?.status === "error" ? p.job.chapter : null;
  const sel = range ?? { from: 0, to: total - 1 };
  const inRange = (i: number) => i >= sel.from && i <= sel.to;
  const notReady = (i: number) => !["ready", "playing"].includes(p.chapterState(i));
  const rangeChars = book.chapters
    .filter((c) => inRange(c.index) && notReady(c.index))
    .reduce((sum, c) => sum + c.chars, 0);
  const rangeToDo = book.chapters.filter((c) => inRange(c.index) && notReady(c.index)).length;
  const batchNarrator = batchVoice || book.voice;
  const cost = costUsd(rangeChars, batchNarrator).toFixed(2);
  async function repair() {
    if (!book) return;
    const todo = book.chapters.map((c) => c.index).filter((i) => !notReady(i));
    let rebuilt = 0;
    let failed = 0;
    for (const [n, index] of todo.entries()) {
      setRepairMsg(`Fixing chapter ${n + 1} of ${todo.length}…`);
      const n2 = await repairChapter(book.id, index);
      if (n2 === null) failed++;
      else rebuilt += n2;
    }
    setRepairMsg(`Fixed ${rebuilt} chapter${rebuilt === 1 ? "" : "s"}${failed ? `; ${failed} failed, try again` : ""}. Nothing was spent.`);
  }

  const eta = formatEta(estimateMs(rangeChars, speed[providerOf(batchNarrator)]));
  const canChangeNarrator = !running && !paused;
  const done = p.readyCount >= total;
  const wholeBook = sel.from === 0 && sel.to === total - 1;
  const runFrom = p.job?.from ?? 0;
  const runTo = p.job?.to ?? total - 1;

  const lead = done
    ? "The whole book is ready to listen to."
    : stalled
      ? "Narration looks stalled. You can resume it where it stopped, or choose chapters below to start again."
      : paused && p.job
        ? `Paused before chapter ${Math.min(p.job.chapter + 1, total)}. Nothing more is spent until you continue.`
      : running && p.job
        ? `Chapter ${Math.min(p.job.chapter + 1, total)} is being read now${runFrom > 0 || runTo < total - 1 ? ` (chapters ${runFrom + 1} to ${runTo + 1})` : ""}. You can close this page; it will keep going.`
        : p.readyCount > 0
          ? `${p.readyCount} of ${total} chapters are ready. The rest are read aloud when you play them, or all at once below.`
          : "Nothing has been read aloud yet. It happens when you press play, or all at once below.";

  return (
    <main className="screen no-tabs narrating" style={{ paddingBottom: 140 }}>
      <div className="topbar">
        <Link href="/" className="icon-btn" aria-label="Back to shelf"><Icon name="back" /></Link>
      </div>

      <div className="ncol">
      <div className="eyebrow" style={{ marginTop: 6 }}>Being read aloud</div>
      <h1 className="title" style={{ marginTop: 6 }}>{book.title}</h1>
      <div className="muted" style={{ marginTop: 6 }}>
        {book.author ? `${book.author} · ` : ""}{total} chapters
      </div>

      <p className="lead" style={{ marginTop: 22 }}>{lead}</p>
      {stalled ? (
        <button className="btn" style={{ marginTop: 12 }} onClick={() => void p.resumeBackground()}>Resume where it stopped</button>
      ) : null}
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
              try {
                await changeNarrator(book.id, e.target.value);
              } catch (err) {
                setNarratorError(err instanceof Error ? err.message : "Couldn't change the narrator.");
                return;
              }
              await p.refreshBook(book.id);
              await p.refreshLibrary();
            }}
          >
            <NarratorOptions groups={groups} keep={book.voice} />
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
            ? p.readyCount > 0
              ? "Changing it affects chapters narrated from now on. Chapters already narrated keep the voice they have."
              : "You can change the narrator until you narrate something; after that, changing it only affects new chapters."
            : "The narrator can be changed when no narration is running."}
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
          <label className="label" htmlFor="batch-voice" style={{ display: "block", marginTop: 14 }}>Voice for these chapters</label>
          <select id="batch-voice" className="select wide" value={batchVoice} onChange={(e) => setBatchVoice(e.target.value)}>
            <option value="">{narratorLabel(book.voice)} (this fic&apos;s voice)</option>
            <NarratorOptions groups={groups} exclude={book.voice} />
          </select>
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {rangeToDo === 0
              ? "Everything in this range is already read aloud."
              : `${rangeToDo} chapter${rangeToDo === 1 ? "" : "s"} to read, about $${cost}. Chapters before ${sel.from + 1} stay unread, so nothing is spent on them.`}
          </p>
        </section>
      ) : null}

      {PROVIDER_INFO[providerOf(book.voice)].needsMp3Repair && p.readyCount > 0 && !running ? (
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => void repair()}>Fix seeking in finished chapters</button>
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
            {repairMsg || "If dragging the slider jumps back to the start, this rebuilds the finished chapters from their saved pieces. Free."}
          </p>
        </div>
      ) : null}

      {p.readyCount > 0 && !running && !paused ? (
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {selecting ? (
            <>
              <button className="btn" onClick={() => setPicked(new Set(book.chapters.filter((c) => !notReady(c.index)).map((c) => c.index)))}>
                Select all narrated
              </button>
              <button className="btn" onClick={() => { setSelecting(false); setPicked(new Set()); }}>Done selecting</button>
            </>
          ) : (
            <button className="btn" onClick={() => setSelecting(true)}>Select chapters to re-read</button>
          )}
        </div>
      ) : null}

      </div>

      <div className="nlist">
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
              {selecting && state === "ready" ? (
                <label className="play-area" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={picked.has(c.index)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(c.index);
                      else next.delete(c.index);
                      setPicked(next);
                    }}
                    aria-label={`Select ${c.title}`}
                  />
                  <span className="nm">{c.title}</span>
                  <span className="mins">{p.chapterMinutes(c.chars)} min</span>
                  <span className="st">{label}</span>
                </label>
              ) : state === "ready" ? (
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
                  <span className="mins">{p.chapterMinutes(c.chars)} min</span>
                  <span className="st">{label}</span>
                </button>
              ) : (
                <>
                  <StateGlyph state={state} />
                  <span className="nm">{c.title}</span>
                  <span className="mins">{p.chapterMinutes(c.chars)} min</span>
                  <span className="st">{label}</span>
                </>
              )}
              {state === "ready" && !selecting ? (
                <button className="dl" aria-label={`Re-read ${c.title}`} onClick={() => dialog.reread({ bookId: book.id, items: [{ index: c.index, title: c.title, chars: c.chars }] })}>
                  <Icon name="retry" size={20} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      </div>

      {selecting ? (
        <div className="sticky-actions">
          <button
            className="btn primary"
            disabled={picked.size === 0}
            onClick={() =>
              dialog.reread({
                bookId: book.id,
                items: book.chapters.filter((c) => picked.has(c.index)).map((c) => ({ index: c.index, title: c.title, chars: c.chars })),
              })
            }
          >
            {picked.size === 0
              ? "Pick chapters to re-read"
              : `Re-read ${picked.size} chapter${picked.size === 1 ? "" : "s"} · about ${formatUsd(costUsd(book.chapters.filter((c) => picked.has(c.index)).reduce((n, c) => n + c.chars, 0), book.voice))}`}
          </button>
          <button className="btn" onClick={() => { setSelecting(false); setPicked(new Set()); }}>Cancel</button>
        </div>
      ) : (
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
        {running ? (
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
            disabled={rangeToDo === 0 && failedHere === null}
            onClick={() => (failedHere !== null ? void p.resumeBackground() : void p.startBackground(sel, batchVoice || undefined))}
          >
            {failedHere !== null
              ? "Resume"
              : wholeBook
                ? "Read it all"
                : sel.from === sel.to
                  ? `Read chapter ${sel.from + 1}`
                  : `Read ${sel.from + 1} to ${sel.to + 1}`}
          </button>
        ) : null}
      </div>
      )}
    </main>
  );
}
