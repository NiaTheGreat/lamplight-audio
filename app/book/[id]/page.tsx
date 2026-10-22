"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, PlayDot, StateGlyph } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { costUsd, formatUsd } from "@/lib/narrators-shared";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export default function Player() {
  const { id } = useParams<{ id: string }>();
  const p = usePlayer();
  const { book, selectBook } = p;
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    void selectBook(id).then((b) => alive && setMissing(!b));
    return () => {
      alive = false;
    };
  }, [id, selectBook]);

  if (missing) {
    return (
      <main className="screen no-tabs">
        <Link href="/" className="icon-btn" aria-label="Back to shelf" style={{ marginLeft: -12 }}>
          <Icon name="back" />
        </Link>
        <p className="empty">That book isn&apos;t stored any more. Add the EPUB again to bring it back.</p>
        <Link href="/add" className="btn primary">Add a fic</Link>
      </main>
    );
  }
  if (!book || book.id !== id) {
    return <main className="screen no-tabs"><p className="empty">Opening…</p></main>;
  }

  const ch = book.chapters[p.chapter];
  const estimate = ch ? (ch.chars / p.charsPerMin) * 60 : 0;
  const total = p.duration || estimate;
  const sleepLabel =
    p.sleep.kind === "off"
      ? "Sleep off"
      : p.sleep.kind === "chapter"
        ? "Sleep · chapter end"
        : `Sleep · ${Math.max(1, Math.ceil((p.sleep.endsAt - Date.now()) / 60000))} min`;
  const preparing = p.preparing?.chapter === p.chapter ? p.preparing : null;
  const unreadChars = book.chapters
    .filter((c) => !["ready", "playing"].includes(p.chapterState(c.index)))
    .reduce((sum, c) => sum + c.chars, 0);
  async function reread(index: number, title: string, chars: number) {
    if (!book) return;
    if (p.job?.status === "running") {
      window.alert("Narration is running for this book. Pause or cancel it first.");
      return;
    }
    const price = formatUsd(costUsd(chars, book.voice));
    if (!window.confirm(`Throw away the narration of "${title}" and read it again? It will be narrated again when you play it, about ${price}.`)) return;
    const res = await fetch(`/api/books/${book.id}/reread`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: index }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Couldn't do that.");
      return;
    }
    await p.refreshBook(book.id);
    await p.refreshLibrary();
  }

  const unfinished = p.readyCount < book.chapters.length;

  return (
    <main className="screen no-tabs book player">
      <div className="topbar">
        <Link href="/" className="icon-btn" aria-label="Back to shelf"><Icon name="back" /></Link>
        <div className="name">{book.title}</div>
        <button className="icon-btn amber" aria-label="Bedside mode" onClick={() => p.setBedside(true)}>
          <Icon name="moon" />
        </button>
      </div>

      <div>
        <div className="hero">
          <div className="numeral" aria-hidden="true">{String(p.chapter + 1).padStart(2, "0")}</div>
          <div className="eyebrow amber" style={{ position: "relative" }}>
            {preparing ? "Getting it ready" : "Now reading"} · {p.chapter + 1} of {book.chapters.length}
          </div>
          <h1 style={{ position: "relative" }}>{ch?.title}</h1>
          {book.author ? <div className="muted" style={{ position: "relative", marginTop: 8 }}>{book.author}</div> : null}
        </div>

        {preparing ? (
          <div className="banner" role="status">
            <span className="grow">Reading this chapter aloud… {preparing.pct}%</span>
          </div>
        ) : null}
        {p.error ? (
          <div className="banner bad" role="alert">
            <span className="grow">{p.error}</span>
            <button className="btn" onClick={() => void p.playChapter(p.chapter)}>
              <Icon name="retry" size={18} />Try again
            </button>
          </div>
        ) : null}

        <div className="scrub">
          <input
            type="range"
            aria-label="Position"
            min={0}
            max={Math.max(1, Math.floor(total))}
            value={Math.min(p.position, Math.max(1, Math.floor(total)))}
            style={{ ["--pct" as string]: `${total ? (Math.min(p.position, total) / total) * 100 : 0}%` }}
            onChange={(e) => p.seek(Number(e.target.value))}
          />
          <div className="times">
            <span>{clock(p.position)}</span>
            <span>{p.duration ? `−${clock(total - p.position)}` : `about ${clock(total)}`}</span>
          </div>
        </div>

        <div className="controls">
          <button className="sm" aria-label="Previous chapter" onClick={p.prevChapter}><Icon name="prev" size={28} /></button>
          <button className="md" aria-label="Back 15 seconds" onClick={() => p.skip(-15)}><Icon name="back15" size={36} stroke={1.4} /></button>
          <button className="play" aria-label={p.playing ? "Pause" : "Play"} disabled={Boolean(preparing)} onClick={() => void p.togglePlay()}>
            <Icon name={p.playing ? "pause" : "play"} size={38} stroke={p.playing ? 2.6 : 1.5} />
          </button>
          <button className="md" aria-label="Forward 15 seconds" onClick={() => p.skip(15)}><Icon name="fwd15" size={36} stroke={1.4} /></button>
          <button className="sm" aria-label="Next chapter" onClick={p.nextChapter}><Icon name="next" size={28} /></button>
        </div>

        <div className="pills">
          <button className="btn" onClick={p.cycleRate} aria-label={`Speed ${p.rate}×, tap to change`}>
            <Icon name="speed" size={20} />{p.rate}×
          </button>
          <button className={`btn ${p.sleep.kind !== "off" ? "on" : ""}`} style={{ flex: 1.5 }} onClick={p.cycleSleep} aria-label="Sleep timer, tap to change">
            <Icon name="moon" size={20} />{sleepLabel}
          </button>
          <button className={`btn ${p.dim > 0 ? "on" : ""}`} onClick={p.cycleDim} aria-label="Screen dimming, tap to change">
            <Icon name="sun" size={20} />Dim
          </button>
        </div>
      {unfinished ? (
        <div className="banner">
          <span className="grow">
            {p.readyCount === 0
              ? "Nothing is narrated yet."
              : `${p.readyCount} of ${book.chapters.length} chapters are narrated.`}{" "}
            About {formatUsd(costUsd(unreadChars, book.voice))} for the rest.
          </span>
          <Link className="btn" href={`/book/${book.id}/narrating`}>Choose chapters</Link>
        </div>
      ) : null}
      </div>

      <section className="sheet" aria-label="Chapters">
        <div className="sheet-head">
          <h2>Chapters</h2>
          <Link href={`/book/${book.id}/narrating`}>
            {p.readyCount} of {book.chapters.length} ready · choose chapters
          </Link>
        </div>
        {book.chapters.map((c) => {
          const state = p.chapterState(c.index);
          const now = c.index === p.chapter;
          const ready = state === "ready" || state === "playing";
          return (
            <div key={c.index} className={`chrow ${now ? "now" : ""} ${state}`} style={{ paddingRight: 0 }}>
              <button className="play-area" onClick={() => void p.playChapter(c.index)} aria-label={`Play ${c.title}`}>
                {state === "ready" ? <PlayDot /> : <StateGlyph state={state} />}
                <span className="nm">{c.title}</span>
                <span className="st">
                  {ready ? `${p.chapterMinutes(c.chars)} min` : state === "failed" ? "Failed" : state === "reading" ? "Reading aloud" : "Read on play"}
                </span>
              </button>
              {ready ? (
                <button className="dl" aria-label={`Re-read ${c.title}`} onClick={() => void reread(c.index, c.title, c.chars)}>
                  <Icon name="retry" size={20} />
                </button>
              ) : null}
              {ready ? (
                <a className="dl" href={`/api/audio/${book.id}/${c.index}?download=1`} download aria-label={`Download ${c.title}`}>
                  <Icon name="download" size={22} />
                </a>
              ) : (
                <span className="dl spacer" />
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}
