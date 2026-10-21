"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
            <div className="s">{p.book.title}</div>
          </Link>
          <button
            className="go"
            aria-label={p.playing ? "Pause" : "Play"}
            onClick={() => void p.togglePlay()}
          >
            <Icon name={p.playing ? "pause" : "play"} size={22} stroke={p.playing ? 2.6 : 1.5} />
          </button>
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
