"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { useReadingProgress } from "@/components/browse/useReadingProgress";
import { usePlayer } from "@/components/PlayerProvider";
import { readStore, writeStore } from "@/components/player/store";
import { getBook, getReading } from "@/lib/client/api";
import type { BookSummary } from "@/lib/types";
import { costUsd, formatUsd } from "@/lib/narrators-shared";
import { Passage } from "./Passage";
import { useBookChapter } from "./useBookChapter";
import type { ReaderView } from "./useReaderView";

const MODE_KEY = "abg:bk-mode";
const SIZE_KEY = "abg:rd-size";
const SPOT_KEY = (bookId: string) => `abg:bk-spot:${bookId}`;
const SIZES = [16, 18, 20, 23];
const THEME_KEY = "abg:bk-theme";
/** Reading themes, like the ones in Apple Books. Colours are in reader.css (`.bk[data-theme]`). */
const THEMES = [
  { id: "lamplight", label: "Lamplight" },
  { id: "calm", label: "Calm" },
  { id: "black", label: "Black" },
] as const;
type Theme = (typeof THEMES)[number]["id"];

const FONT_KEY = "abg:bk-font";
const BOLD_KEY = "abg:bk-bold";
const LEADING_KEY = "abg:bk-leading";
/** Reading fonts. The stacks are in reader.css (`.bk[data-font]`). */
const FONTS = [
  { id: "literata", label: "Literata" },
  { id: "atkinson", label: "Atkinson" },
  { id: "system", label: "Georgia" },
  { id: "lamplight", label: "Lamplight" },
] as const;
type Font = (typeof FONTS)[number]["id"];
const LEADINGS = [
  { v: 1.45, label: "Tight" },
  { v: 1.65, label: "Normal" },
  { v: 1.9, label: "Roomy" },
];
const NO_SENTENCES: never[] = [];

type Mode = "scroll" | "paged";
type Spot = { chapter: number; frac: number };

/**
 * The book on its own, like an e-book app: just the text, a menu on a tap in the middle, and no
 * player. It never narrates anything by itself. The headphones button goes to Listen.
 *
 * Reading and listening keep separate places. This view loads its own copy of the book and its
 * own chapter (from the link, the spot kept on this device, or Browse's reading state), and never
 * opens the book in the player, so what is being listened to, and where, is not touched. Only the
 * headphones button reaches the player, and only when asked to narrate a chapter.
 */
export function BookReader({ reader, bookId }: { reader: ReaderView; bookId: string }) {
  const p = usePlayer();
  const dialog = useDialog();
  const [book, setBook] = useState<BookSummary | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    void getBook(bookId).then((b) => {
      if (!alive) return;
      if (b) setBook(b);
      else setMissing(true);
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const [chapter, setChapter] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("paged");
  const [size, setSize] = useState(1);
  const [theme, setTheme] = useState<Theme>("lamplight");
  const [font, setFont] = useState<Font>("literata");
  const [bold, setBold] = useState(false);
  const [leading, setLeading] = useState(1.65);
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<null | "text" | "chapters">(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [frac, setFrac] = useState(0);
  const [done, setDone] = useState<number[]>([]);
  const [atEnd, setAtEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const restore = useRef<Spot | null>(null);
  const asked = useRef<number | null | undefined>(undefined);
  const goLast = useRef(false);

  useEffect(() => {
    setMode(readStore<Mode>(MODE_KEY, "paged") === "scroll" ? "scroll" : "paged");
    setSize(Math.min(SIZES.length - 1, Math.max(0, readStore<number>(SIZE_KEY, 1))));
    const t = readStore<string>(THEME_KEY, "lamplight");
    setTheme(THEMES.some((x) => x.id === t) ? (t as Theme) : "lamplight");
    const f = readStore<string>(FONT_KEY, "literata");
    setFont(FONTS.some((x) => x.id === f) ? (f as Font) : "literata");
    setBold(readStore<boolean>(BOLD_KEY, false) === true);
    const l = readStore<number>(LEADING_KEY, 1.65);
    setLeading(LEADINGS.some((x) => x.v === l) ? l : 1.65);
  }, []);
  // The page behind the reader takes the theme's colour too (wide screens, overscroll).
  useEffect(() => {
    const color = { lamplight: "", calm: "#3a332a", black: "#000" }[theme];
    const prev = document.body.style.background;
    document.body.style.background = color;
    return () => {
      document.body.style.background = prev;
    };
  }, [theme]);

  // Where to start: the chapter Browse asked for (?chapter=), else where this device left off, else
  // where the reading state says; with the place left in it if it is the same chapter.
  useEffect(() => {
    if (!book || chapter !== null) return;
    let alive = true;
    if (asked.current === undefined) {
      const url = new URL(location.href);
      const raw = url.searchParams.get("chapter");
      asked.current = raw !== null && Number.isInteger(Number(raw)) ? Number(raw) : null;
      // Drop it once read, so a reload returns to where you are, not to where you began.
      if (raw !== null) {
        url.searchParams.delete("chapter");
        history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    }
    const spot = readStore<Spot | null>(SPOT_KEY(bookId), null);
    void (async () => {
      let start: number | null = null;
      const want = asked.current ?? null;
      if (want !== null && book.chapters[want]) start = want;
      if (start === null && spot && book.chapters[spot.chapter]) start = spot.chapter;
      if (start === null) {
        const c = (await getReading())[bookId]?.chapter;
        if (typeof c === "number" && book.chapters[c]) start = c;
      }
      if (!alive) return;
      if (spot && spot.chapter === start) restore.current = spot;
      setChapter(start ?? 0);
    })();
    return () => {
      alive = false;
    };
  }, [book, bookId, chapter]);
  useEffect(() => {
    if (!bookId) return;
    void getReading().then((r) => setDone(r[bookId]?.done ?? []));
  }, [bookId, sheet]);

  const ch = chapter ?? 0;
  const total = book?.chapters.length ?? 0;
  useReadingProgress(bookId, ch, total, atEnd);
  useEffect(() => setAtEnd(false), [bookId, ch]);

  const { data, failed } = useBookChapter(bookId, ch, total);
  const sentences = NO_SENTENCES;

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

  // A new chapter starts at its top (or its last page when turned back into).
  useEffect(() => {
    setPage(0);
    setFrac(0);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [ch, mode]);
  useEffect(() => {
    if (!data) return;
    if (restore.current && restore.current.chapter === ch) {
      const f = restore.current.frac;
      restore.current = null;
      if (mode === "paged") setPage(Math.min(pages - 1, Math.round(f * (pages - 1))));
      else if (bodyRef.current) {
        const b = bodyRef.current;
        b.scrollTop = f * Math.max(0, b.scrollHeight - b.clientHeight);
      }
    } else if (goLast.current && mode === "paged") {
      goLast.current = false;
      setPage(pages - 1);
    }
  }, [data, pages, mode, ch]);

  useEffect(() => {
    if (mode === "paged") {
      setFrac(pages > 1 ? page / (pages - 1) : 1);
      if (data && page >= pages - 1) setAtEnd(true);
    }
  }, [mode, page, pages, data]);

  const onScroll = () => {
    const b = bodyRef.current;
    if (!b || mode !== "scroll" || !data) return;
    const room = Math.max(1, b.scrollHeight - b.clientHeight);
    setFrac(Math.min(1, b.scrollTop / room));
    if (b.scrollTop + b.clientHeight >= b.scrollHeight - 48) setAtEnd(true);
  };
  useEffect(() => onScroll());

  // Remember the place in the chapter.
  useEffect(() => {
    if (!bookId || chapter === null || !data) return;
    const t = setTimeout(() => writeStore(SPOT_KEY(bookId), { chapter, frac }), 600);
    return () => clearTimeout(t);
  }, [bookId, chapter, frac, data]);

  const go = useCallback(
    (to: number, last = false) => {
      if (to < 0 || to >= total) return;
      goLast.current = last;
      setChapter(to);
      setSheet(null);
    },
    [total],
  );
  const turn = (d: number) => {
    if (d > 0) {
      if (page < pages - 1) setPage(page + 1);
      else go(ch + 1);
    } else if (page > 0) setPage(page - 1);
    else go(ch - 1, true);
  };

  const onTap = (e: React.MouseEvent) => {
    if (sheet) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    if (mode === "paged" && !menu) {
      if (x < 0.25) return turn(-1);
      if (x > 0.75) return turn(1);
    }
    setMenu((m) => !m);
  };

  const chooseMode = (m: Mode) => {
    setMode(m);
    writeStore(MODE_KEY, m);
  };
  const chooseTheme = (t: Theme) => {
    setTheme(t);
    writeStore(THEME_KEY, t);
  };
  const chooseFont = (f: Font) => {
    setFont(f);
    writeStore(FONT_KEY, f);
  };
  const chooseBold = (b: boolean) => {
    setBold(b);
    writeStore(BOLD_KEY, b);
  };
  const chooseLeading = (l: number) => {
    setLeading(l);
    writeStore(LEADING_KEY, l);
  };
  const chooseSize = (i: number) => {
    setSize(i);
    writeStore(SIZE_KEY, i);
  };

  const headphones = async () => {
    if (!book) return;
    if (book.narrated?.includes(ch)) {
      // Listen where you left off listening. Only a book never listened to starts at this chapter.
      if (!p.progress.books[bookId]) await p.selectBook(bookId, ch);
      reader.setView("listen");
      return;
    }
    const c = book.chapters[ch];
    const price = costUsd(c?.chars ?? 0, book.voice);
    const ok = await dialog.confirm({
      title: "Listen to this chapter?",
      body: `It isn't narrated yet. Narrating it costs about ${formatUsd(price)}.`,
      confirmLabel: "Narrate chapter",
      cancelLabel: "Keep reading",
    });
    if (!ok) return;
    await p.selectBook(bookId, ch);
    reader.setView("listen");
    void p.playChapter(ch);
  };

  const percent = useMemo(() => {
    if (!book) return 0;
    const sum = book.chapters.reduce((s, c) => s + c.chars, 0) || 1;
    const before = book.chapters.slice(0, ch).reduce((s, c) => s + c.chars, 0);
    return Math.min(
      100,
      Math.round(((before + (book.chapters[ch]?.chars ?? 0) * frac) / sum) * 100),
    );
  }, [book, ch, frac]);

  if (missing) {
    return (
      <main className="bk">
        <Link href="/browse" className="icon-btn" aria-label="Back to Browse">
          <Icon name="back" />
        </Link>
        <p className="empty">That book isn&apos;t stored any more.</p>
      </main>
    );
  }
  if (!book || chapter === null) {
    return (
      <main className="bk">
        <p className="empty">Opening…</p>
      </main>
    );
  }
  const title = book.chapters[ch]?.title ?? "";

  return (
    <main
      className="bk"
      data-theme={theme}
      data-font={font}
      data-bold={bold ? "1" : undefined}
      style={{ ["--rd-size" as string]: `${SIZES[size]}px`, ["--bk-leading" as string]: leading }}
    >
      {menu || sheet ? null : (
        <div className="bk-run top">
          {ch + 1} of {total} · {title}
        </div>
      )}
      <div
        ref={bodyRef}
        className={`rd-body ${mode} bk-body`}
        onClick={onTap}
        onScroll={onScroll}
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
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
            {data.paras.map((para, i) => (
              <Passage key={i} para={para} sentences={sentences} active={-1} />
            ))}
            {mode === "scroll" && ch < total - 1 ? (
              <button
                className="btn bk-next"
                onClick={(e) => {
                  e.stopPropagation();
                  go(ch + 1);
                }}
              >
                Next chapter
              </button>
            ) : null}
          </div>
        )}
      </div>
      {menu || sheet ? null : (
        <div className="bk-run bottom">
          {mode === "paged" ? `page ${page + 1} of ${pages} · ` : ""}
          {percent}% through the book
        </div>
      )}

      {menu ? (
        <>
          <div className="bk-bar top">
            <Link href="/browse" className="icon-btn" aria-label="Back to Browse">
              <Icon name="back" />
            </Link>
            <div className="bk-title">{book.title}</div>
            <button
              className="icon-btn"
              aria-label="Text settings"
              onClick={() => setSheet("text")}
            >
              <Icon name="textsize" size={22} />
            </button>
            <button className="icon-btn" aria-label="Chapters" onClick={() => setSheet("chapters")}>
              <Icon name="queue" size={22} />
            </button>
            <button className="icon-btn" aria-label="Listen" onClick={() => void headphones()}>
              <Icon name="headphones" size={22} />
            </button>
          </div>
          <div className="bk-bar bottom">
            <div className="bk-prog">
              <i style={{ width: `${percent}%` }} />
            </div>
            <div className="bk-meta">
              <span>
                Chapter {ch + 1} of {total}
              </span>
              <span>{percent}%</span>
            </div>
          </div>
        </>
      ) : null}

      {sheet ? (
        <>
          <button className="bk-dim" aria-label="Close" onClick={() => setSheet(null)} />
          <div className={`bk-sheet ${sheet}`} role="dialog" aria-label={sheet}>
            {sheet === "text" ? (
              <>
                <h2>Text</h2>
                <div className="bk-size">
                  <span className="rd-a sm">A</span>
                  <input
                    type="range"
                    aria-label="Text size"
                    min={0}
                    max={SIZES.length - 1}
                    value={size}
                    onChange={(e) => chooseSize(Number(e.target.value))}
                  />
                  <span className="rd-a">A</span>
                </div>
                <div className="bk-fonts" role="radiogroup" aria-label="Font">
                  {FONTS.map((f) => (
                    <button
                      key={f.id}
                      role="radio"
                      aria-checked={font === f.id}
                      className={`bk-font ${f.id}${font === f.id ? " on" : ""}`}
                      onClick={() => chooseFont(f.id)}
                    >
                      <span>Aa</span>
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="bk-row">
                  <span>Bold text</span>
                  <button
                    role="switch"
                    aria-checked={bold}
                    aria-label="Bold text"
                    className={`bk-switch${bold ? " on" : ""}`}
                    onClick={() => chooseBold(!bold)}
                  />
                </div>
                <div className="bk-seg" role="radiogroup" aria-label="Line spacing">
                  {LEADINGS.map((l) => (
                    <button
                      key={l.v}
                      role="radio"
                      aria-checked={leading === l.v}
                      className={leading === l.v ? "on" : ""}
                      onClick={() => chooseLeading(l.v)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                <div className="bk-themes" role="radiogroup" aria-label="Theme">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      role="radio"
                      aria-checked={theme === t.id}
                      className={`bk-theme ${t.id}${theme === t.id ? " on" : ""}`}
                      onClick={() => chooseTheme(t.id)}
                    >
                      <span>Aa</span>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="bk-seg" role="tablist" aria-label="Layout">
                  {(["paged", "scroll"] as const).map((m) => (
                    <button
                      key={m}
                      role="tab"
                      aria-selected={mode === m}
                      className={mode === m ? "on" : ""}
                      onClick={() => chooseMode(m)}
                    >
                      {m === "paged" ? "Pages" : "Scroll"}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <h2>Chapters</h2>
                <div className="bk-chapters">
                  {book.chapters.map((c) => (
                    <button
                      key={c.index}
                      className={`bk-ch${c.index === ch ? " cur" : ""}`}
                      onClick={() => go(c.index)}
                    >
                      <span>{c.title}</span>
                      <span>
                        {c.index === ch ? "you are here" : done.includes(c.index) ? "read" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </main>
  );
}
