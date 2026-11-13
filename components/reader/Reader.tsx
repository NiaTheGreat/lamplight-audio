"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { useReadingProgress } from "@/components/browse/useReadingProgress";
import { usePlayer } from "@/components/PlayerProvider";
import { readStore, writeStore } from "@/components/player/store";
import { attachEpub } from "@/lib/client/reader";
import { sentenceAt, splitSentences } from "@/lib/reader/sentences";
import { Passage, type ParaSentence } from "./Passage";
import { useChapterText } from "./useChapterText";
import { ViewSwitch } from "./ViewSwitch";
import type { ReaderView } from "./useReaderView";

const MODE_KEY = "abg:rd-mode";
const SIZE_KEY = "abg:rd-size";
const SPOT_KEY = (bookId: string) => `abg:rd-spot:${bookId}`;
const SIZES = [16, 18, 20, 23];

type Mode = "scroll" | "paged";
type Spot = { chapter: number; sentence: number };

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The reading side of the book screen: the chapter text, following the audio and steering it. */
export function Reader({ reader }: { reader: ReaderView }) {
  const p = usePlayer();
  const dialog = useDialog();
  const { book } = p;
  const bookId = book?.id ?? "";

  const [mode, setMode] = useState<Mode>("scroll");
  const [size, setSize] = useState(1);
  const [follow, setFollow] = useState(true);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [spot, setSpot] = useState<Spot | null>(null);
  // Right after a tap the player's whole-second position can still sit just before the sentence.
  const [tapped, setTapped] = useState<{ chapter: number; sentence: number; pos: number } | null>(
    null,
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const attachRef = useRef<HTMLInputElement>(null);

  // Browse's Unread / Reading / Finished: the chapter being read, and whether its end was reached.
  const [atEnd, setAtEnd] = useState(false);
  useReadingProgress(bookId, p.chapter, book?.chapters.length ?? 0, atEnd);
  useEffect(() => setAtEnd(false), [bookId, p.chapter]);

  const state = p.chapterState(p.chapter);
  const ready = state === "ready" || state === "playing";
  const { data, failed } = useChapterText(bookId, p.chapter, ready);

  // Device-local choices, read after mount so the server and first render agree.
  useEffect(() => {
    setMode(readStore<Mode>(MODE_KEY, "scroll") === "paged" ? "paged" : "scroll");
    setSize(Math.min(SIZES.length - 1, Math.max(0, readStore<number>(SIZE_KEY, 1))));
  }, []);
  useEffect(() => {
    if (bookId) setSpot(readStore<Spot | null>(SPOT_KEY(bookId), null));
  }, [bookId]);

  const sentences = useMemo(() => (data ? splitSentences(data.paras) : []), [data]);
  const byPara = useMemo(() => {
    const m = new Map<number, ParaSentence[]>();
    sentences.forEach((s, gi) => {
      const list = m.get(s.p) ?? [];
      list.push({ gi, a: s.a, b: s.b });
      m.set(s.p, list);
    });
    return m;
  }, [sentences]);

  const times = data && data.times && data.times.length === sentences.length ? data.times : null;
  const synced = Boolean(ready && times && data?.total);
  // The audio element's real length wins over the measured one if they differ a little.
  const scale = synced && p.duration > 0 && data?.total ? data.total / p.duration : 1;
  // If the player's idea of the chapter's length is off, its clock and the measured times disagree.
  const lengthOff =
    synced && p.duration > 0 && data?.total ? Math.abs(p.duration / data.total - 1) > 0.02 : false;
  const fromAudio = synced && times ? sentenceAt(times, (p.position + 0.5) * scale) : -1;
  const fromSpot =
    spot && spot.chapter === p.chapter ? Math.min(spot.sentence, sentences.length - 1) : 0;
  const holdTap = tapped && tapped.chapter === p.chapter && tapped.pos === p.position;
  const active = holdTap ? tapped.sentence : fromAudio >= 0 ? fromAudio : fromSpot;

  const remember = useCallback(
    (sentence: number) => {
      const next = { chapter: p.chapter, sentence };
      setSpot(next);
      if (bookId) writeStore(SPOT_KEY(bookId), next);
    },
    [bookId, p.chapter],
  );

  // A chapter read before it was narrated: once it is, start the audio where the reading got to.
  const carried = useRef("");
  useEffect(() => {
    if (!synced || !times || !spot || spot.chapter !== p.chapter) return;
    const key = `${bookId}:${p.chapter}`;
    if (carried.current === key) return;
    carried.current = key;
    if (p.position < 2 && !p.playing && spot.sentence > 0 && times[spot.sentence] !== undefined) {
      p.seek(times[spot.sentence] / scale);
    }
  }, [synced, times, spot, p, bookId, scale]);

  const tapSentence = useCallback(
    (gi: number) => {
      remember(gi);
      setFollow(true);
      if (synced && times) {
        const target = times[gi] / scale;
        setTapped({ chapter: p.chapter, sentence: gi, pos: Math.floor(target) });
        p.seek(target);
        if (!p.playing) void p.togglePlay();
      }
    },
    [remember, synced, times, p, scale],
  );

  // ----- paged layout -----
  const measure = useCallback(() => {
    const body = bodyRef.current;
    const flow = flowRef.current;
    if (!body || !flow || mode !== "paged") return;
    setPages(Math.max(1, Math.round(flow.scrollWidth / body.clientWidth)));
  }, [mode]);

  useLayoutEffect(() => {
    measure();
    const body = bodyRef.current;
    if (!body || mode !== "paged") return;
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, [measure, data, size, mode]);

  // Reached the end of the chapter: the last page, or scrolled to the bottom (or it all fits).
  useEffect(() => {
    if (data && mode === "paged" && page >= pages - 1) setAtEnd(true);
  }, [data, mode, page, pages]);
  const checkScrollEnd = useCallback(() => {
    const body = bodyRef.current;
    if (!body || mode !== "scroll" || !data) return;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 48) setAtEnd(true);
  }, [mode, data]);
  useEffect(() => checkScrollEnd(), [checkScrollEnd, size]);

  const pageOf = useCallback((el: Element | null) => {
    const body = bodyRef.current;
    const flow = flowRef.current;
    if (!el || !body || !flow) return 0;
    const rect = el.getClientRects()[0];
    if (!rect) return 0;
    return Math.max(
      0,
      Math.floor((rect.left - flow.getBoundingClientRect().left + 2) / body.clientWidth),
    );
  }, []);

  const sentenceEl = (gi: number) => flowRef.current?.querySelector(`[data-s="${gi}"]`) ?? null;

  // Keep the lit sentence in view: scroll to it, or turn to its page.
  useEffect(() => {
    if (!data || !follow) return;
    const el = sentenceEl(active);
    if (!el) return;
    if (mode === "paged") setPage(Math.min(pages - 1, pageOf(el)));
    else {
      const body = bodyRef.current;
      if (!body) return;
      const box = body.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const target = body.scrollTop + (r.top - box.top) - box.height * 0.35;
      body.scrollTo({
        top: Math.max(0, target),
        behavior: synced && p.playing ? "smooth" : "auto",
      });
    }
  }, [active, data, follow, mode, pages, pageOf, synced, p.playing]);

  // Reaching for the page ourselves ends following until "Back to reading".
  const leave = useCallback(() => setFollow(false), []);
  const turn = useCallback(
    (d: number) => {
      setFollow(false);
      setPage((x) => Math.max(0, Math.min(pages - 1, x + d)));
    },
    [pages],
  );

  const onBodyClick = (e: React.MouseEvent) => {
    if (mode === "paged") {
      const box = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      if (x < 0.2) return turn(-1);
      if (x > 0.8) return turn(1);
    }
    const s = (e.target as HTMLElement).closest("[data-s]");
    const gi = s ? Number(s.getAttribute("data-s")) : NaN;
    if (!Number.isNaN(gi)) tapSentence(gi);
  };

  const chooseMode = (m: Mode) => {
    setMode(m);
    writeStore(MODE_KEY, m);
    setFollow(true);
  };
  const chooseSize = (d: number) => {
    const next = Math.max(0, Math.min(SIZES.length - 1, size + d));
    setSize(next);
    writeStore(SIZE_KEY, next);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const err = await attachEpub(bookId, file);
    if (err) await dialog.notify("Couldn't attach that EPUB", err);
    else {
      await reader.refresh();
      setFollow(true);
      location.reload();
    }
  };

  if (!book) return null;
  const preparing = p.preparing?.chapter === p.chapter ? p.preparing : null;
  const total = p.duration || (data?.total ?? 0);

  return (
    <main className="rd" style={{ ["--rd-size" as string]: `${SIZES[size]}px` }}>
      <div className="rd-top">
        <Link href="/" className="icon-btn" aria-label="Back to shelf">
          <Icon name="back" />
        </Link>
        <ViewSwitch reader={reader} />
        <div className="rd-tools">
          <button
            className="icon-btn"
            aria-label="Smaller text"
            onClick={() => chooseSize(-1)}
            disabled={size === 0}
          >
            <span className="rd-a sm">A</span>
          </button>
          <button
            className="icon-btn"
            aria-label="Larger text"
            onClick={() => chooseSize(1)}
            disabled={size === SIZES.length - 1}
          >
            <span className="rd-a">A</span>
          </button>
          <button
            className="icon-btn"
            aria-label={mode === "scroll" ? "Switch to pages" : "Switch to scrolling"}
            onClick={() => chooseMode(mode === "scroll" ? "paged" : "scroll")}
          >
            <Icon name={mode === "scroll" ? "book" : "queue"} size={22} />
          </button>
        </div>
      </div>
      <div className="rd-head">
        <div className="eyebrow amber">
          {p.chapter + 1} of {book.chapters.length}
          {mode === "paged" ? ` · page ${page + 1} of ${pages}` : ""}
        </div>
      </div>

      {data && !data.formatted ? (
        <div className="banner rd-note">
          <span className="grow">
            {reader.hasEpub
              ? "This chapter is shown as plain text."
              : "Shown as plain text. Attach this book's EPUB for italics and scene breaks."}
          </span>
          {!reader.hasEpub ? (
            <>
              <button className="btn" onClick={() => attachRef.current?.click()}>
                Attach EPUB
              </button>
              <input
                ref={attachRef}
                type="file"
                accept=".epub,application/epub+zip"
                hidden
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </>
          ) : null}
        </div>
      ) : null}
      {data && !ready ? (
        <div className="banner rd-note">
          <span className="grow">Not narrated yet. Read on, or have it read aloud.</span>
          <button className="btn" onClick={() => void p.playChapter(p.chapter)}>
            <Icon name="play" size={18} />
            Read aloud
          </button>
        </div>
      ) : null}
      {ready && data && !synced ? (
        <div className="banner rd-note">
          <span className="grow">
            This chapter&apos;s timing isn&apos;t available, so the page can&apos;t follow the
            audio.
          </span>
        </div>
      ) : null}

      {lengthOff && data?.total ? (
        <div className="banner rd-note">
          <span className="grow">
            This device measures the chapter as {clock(p.duration)}, but it is {clock(data.total)}{" "}
            long, so the highlight may drift.
          </span>
        </div>
      ) : null}

      <div
        ref={bodyRef}
        className={`rd-body ${mode}`}
        onClick={onBodyClick}
        onScroll={checkScrollEnd}
        onWheel={mode === "scroll" ? leave : undefined}
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchMove={mode === "scroll" ? leave : undefined}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (mode !== "paged" || start === null) return;
          const dx = e.changedTouches[0].clientX - start;
          if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1);
        }}
      >
        {failed ? (
          <p className="empty">Couldn&apos;t load this chapter. Try again in a moment.</p>
        ) : !data ? (
          <p className="empty">Opening…</p>
        ) : (
          <div
            ref={flowRef}
            className="rd-flow"
            style={
              mode === "paged"
                ? {
                    columnWidth: bodyRef.current?.clientWidth,
                    transform: `translateX(-${page * (bodyRef.current?.clientWidth ?? 0)}px)`,
                  }
                : undefined
            }
          >
            {data.paras.map((para, i) => {
              const list = byPara.get(i) ?? [];
              const lit = list.some((s) => s.gi === active) ? active : -1;
              return <Passage key={i} para={para} sentences={list} active={lit} />;
            })}
          </div>
        )}
        {!follow && synced ? (
          <button
            className="btn primary rd-back"
            onClick={(e) => {
              e.stopPropagation();
              setFollow(true);
            }}
          >
            Back to reading
          </button>
        ) : null}
      </div>

      <div className="rd-bar">
        {preparing ? (
          <div className="rd-prep">Reading this chapter aloud… {preparing.pct}%</div>
        ) : null}
        <div className="scrub">
          <input
            type="range"
            aria-label="Position"
            min={0}
            max={Math.max(1, Math.floor(total))}
            value={Math.min(p.position, Math.max(1, Math.floor(total)))}
            style={{
              ["--pct" as string]: `${total ? (Math.min(p.position, total) / total) * 100 : 0}%`,
            }}
            onChange={(e) => {
              setFollow(true);
              p.seek(Number(e.target.value));
            }}
          />
          <div className="times">
            <span>{clock(p.position)}</span>
            <span>{total ? `−${clock(Math.max(0, total - p.position))}` : ""}</span>
          </div>
        </div>
        <div className="controls">
          <button className="sm" aria-label="Previous chapter" onClick={p.prevChapter}>
            <Icon name="prev" size={26} />
          </button>
          <button className="md" aria-label="Back 15 seconds" onClick={() => p.skip(-15)}>
            <Icon name="back15" size={32} stroke={1.4} />
          </button>
          <button
            className="play"
            aria-label={p.playing ? "Pause" : "Play"}
            disabled={Boolean(preparing)}
            onClick={() => {
              setFollow(true);
              void p.togglePlay();
            }}
          >
            <Icon name={p.playing ? "pause" : "play"} size={34} stroke={p.playing ? 2.6 : 1.5} />
          </button>
          <button className="md" aria-label="Forward 15 seconds" onClick={() => p.skip(15)}>
            <Icon name="fwd15" size={32} stroke={1.4} />
          </button>
          <button className="sm" aria-label="Next chapter" onClick={p.nextChapter}>
            <Icon name="next" size={26} />
          </button>
        </div>
      </div>
    </main>
  );
}
