"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { formatUsd, narratorLabel } from "@/lib/narrators-shared";
import { Icon } from "./Icon";
import { usePlayer } from "./PlayerProvider";

function formatRemaining(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60000));
  return `${min} min`;
}

/** Everything that stays put while screens change: tabs, mini player, dimming, bedside mode. */
export function AppChrome() {
  const pathname = usePathname();
  const p = usePlayer();
  if (pathname === "/login") return <div className="dim" style={{ opacity: 0 }} />;

  const inBook = pathname.startsWith("/book/");
  const showMini = p.book && !inBook && !p.bedside;
  const tabs = [
    { href: "/", label: "Shelf", icon: "shelf" as const, active: pathname === "/" },
    { href: "/add", label: "Add", icon: "add" as const, active: pathname === "/add" },
    { href: "/settings", label: "Settings", icon: "settings" as const, active: pathname === "/settings" },
  ];

  return (
    <>
      {showMini && p.book ? (
        <div className="mini">
          <Link href={`/book/${p.book.id}`}>
            <div className="t">{p.book.chapters[p.chapter]?.title ?? p.book.title}</div>
            <div className="s">
              {p.preparing ? `Reading aloud… ${p.preparing.pct}%` : p.book.title}
            </div>
          </Link>
          <button
            className="go"
            aria-label={p.preparing ? "Getting it ready" : p.playing ? "Pause" : "Play"}
            disabled={Boolean(p.preparing)}
            onClick={() => void p.togglePlay()}
          >
            <Icon name={p.playing ? "pause" : "play"} size={22} stroke={p.playing ? 2.6 : 1.5} />
          </button>
          {p.preparing ? (
            <div className="mini-bar" role="progressbar" aria-valuenow={p.preparing.pct} aria-valuemin={0} aria-valuemax={100}>
              <i style={{ width: `${Math.max(p.preparing.pct, 3)}%` }} />
            </div>
          ) : null}
        </div>
      ) : null}

      {!inBook ? (
        <nav className="tabbar" aria-label="Main">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {p.bedside && p.book ? <Bedside formatRemaining={formatRemaining} /> : null}

      {p.pendingNarration ? <NarrationConfirm /> : null}

      <div className="dim" aria-hidden="true" style={{ opacity: (p.dim / 100) * 0.75 }} />
    </>
  );
}

function Bedside({ formatRemaining }: { formatRemaining: (ms: number) => string }) {
  const p = usePlayer();
  const book = p.book!;
  const sleepText =
    p.sleep.kind === "minutes"
      ? `Pauses in ${formatRemaining(p.sleep.endsAt - Date.now())}`
      : p.sleep.kind === "chapter"
        ? "Pauses at the end of this chapter"
        : "No sleep timer";

  return (
    <div className="bedside" role="dialog" aria-label="Bedside mode">
      <div className="bar">
        <span>Bedside</span>
        <button className="icon-btn" aria-label="Brighten and leave bedside mode" onClick={() => p.setBedside(false)}>
          <Icon name="sun" />
        </button>
      </div>
      <h1>{book.chapters[p.chapter]?.title ?? `Chapter ${p.chapter + 1}`}</h1>
      <div className="sub">{book.title}</div>
      <div className="sleep">
        <Icon name="moon" size={20} />
        {sleepText}
      </div>
      <div className="bigcontrols">
        <button aria-label="Back 15 seconds" onClick={() => p.skip(-15)}>
          <Icon name="back15" size={40} stroke={1.3} />
        </button>
        <button className="main" aria-label={p.playing ? "Pause" : "Play"} onClick={() => void p.togglePlay()}>
          <Icon name={p.playing ? "pause" : "play"} size={52} stroke={p.playing ? 2.4 : 1.5} />
        </button>
        <button aria-label="Forward 15 seconds" onClick={() => p.skip(15)}>
          <Icon name="fwd15" size={40} stroke={1.3} />
        </button>
      </div>
      <div className="pair">
        <button onClick={() => p.setSleepMinutes(p.sleep.kind === "minutes" ? p.sleep.minutes + 15 : 15)}>
          Add 15 min
        </button>
        <button onClick={() => p.setSleepMinutes(-1)}>Stop at chapter end</button>
      </div>
      <p className="note">Screen at its dimmest. Audio keeps playing when the phone locks.</p>
    </div>
  );
}

/** "Read this chapter aloud? About $0.12." Shown before any chapter that isn't narrated yet is started. */
function NarrationConfirm() {
  const p = usePlayer();
  const pending = p.pendingNarration!;
  const yes = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    yes.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.cancelNarration();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cost = pending.costUsd < 0.005 ? "less than a cent" : `about ${formatUsd(pending.costUsd)}`;
  return (
    <div className="modal-backdrop" onClick={p.cancelNarration}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="serif">Read this chapter aloud?</h2>
        <p className="lead-sm">{pending.title}</p>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          It costs {cost} with {narratorLabel(pending.narrator)}, and it&apos;s saved afterwards, so listening again is free.
        </p>
        <div className="modal-actions">
          <button ref={yes} className="btn primary" onClick={p.confirmNarration}>
            Read it aloud
          </button>
          <button className="btn" onClick={p.cancelNarration}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
