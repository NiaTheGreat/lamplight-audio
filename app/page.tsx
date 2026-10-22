"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import { USD_PER_MILLION_CHARS, usePlayer } from "@/components/PlayerProvider";
import { bindingFor, Ticks } from "@/components/Ticks";

export default function Library() {
  const router = useRouter();
  const p = usePlayer();

  // Books added before chapter lengths were recorded: opening them once fills the lengths in,
  // so ask for each (one at a time) and then reload the shelf.
  const missing = p.library.filter((b) => !b.chars).map((b) => b.id).join(",");
  useEffect(() => {
    if (!missing) return;
    let alive = true;
    (async () => {
      for (const id of missing.split(",")) {
        if (!alive) return;
        await fetch(`/api/books/${id}`).catch(() => {});
      }
      if (alive) await p.refreshLibrary();
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  const last = p.progress.last;
  const lastEntry = last ? p.library.find((b) => b.id === last.id) : undefined;

  async function resume(id: string) {
    router.push(`/book/${id}`);
    await p.openBook(id);
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Remove "${title}" from your shelf? Narration already made is kept.`)) return;
    await p.removeBook(id);
  }

  return (
    <main className="screen">
      <div className="eyebrow">Your shelf</div>
      <h1 className="display">Tonight</h1>

      {lastEntry && last ? (
        <section className="section" aria-label="Where you left off">
          <div className="eyebrow">Where you left off</div>
          <div className="continue">
            <div className="row">
              <Link href={`/book/${lastEntry.id}`} style={{ flexGrow: 1, minWidth: 0, textDecoration: "none" }}>
                <div className="name">{lastEntry.title}</div>
                {lastEntry.author ? <div className="muted" style={{ marginTop: 4 }}>{lastEntry.author}</div> : null}
                <div className="faint" style={{ marginTop: 10, fontSize: 13 }}>
                  Chapter {Math.min(last.chapter + 1, lastEntry.chapterCount)} of {lastEntry.chapterCount}
                </div>
              </Link>
              <button className="round-play" aria-label={`Resume ${lastEntry.title}`} onClick={() => void resume(lastEntry.id)}>
                <Icon name="play" size={26} />
              </button>
            </div>
            <div className="hairline">
              <i style={{ width: `${(Math.min(last.chapter + 1, lastEntry.chapterCount) / lastEntry.chapterCount) * 100}%` }} />
            </div>
          </div>
        </section>
      ) : null}

      <section className="section" aria-label="The shelf">
        <div className="eyebrow">The shelf</div>
        {p.libraryError && p.library.length === 0 ? (
          <p className="error" role="alert">{p.libraryError}</p>
        ) : null}
        {p.libraryLoaded && p.library.length === 0 ? (
          <p className="empty">Nothing here yet. Add a fic to start your shelf.</p>
        ) : null}
        <div className="shelf">
          {p.library.map((b) => {
            const narrated = b.narrated?.length ?? 0;
            const started = Boolean(p.progress.books[b.id]);
            const done = new Set(b.narrated ?? []);
            const remainingChars = (b.chars ?? []).reduce((sum, n, i) => (done.has(i) ? sum : sum + n), 0);
            const cost = b.chars && remainingChars > 0 ? `$${((remainingChars * USD_PER_MILLION_CHARS) / 1_000_000).toFixed(2)} to finish` : "";
            return (
              <div key={b.id} style={{ position: "relative" }}>
                <Link
                  className="spine"
                  // A book nothing has been narrated or listened to yet opens on the chapter picker.
                  href={narrated === 0 && !started ? `/book/${b.id}/narrating` : `/book/${b.id}`}
                  style={{ ["--spine" as string]: bindingFor(b.id) }}
                >
                  <div className="binding" aria-hidden="true">
                    <i />
                    <i />
                  </div>
                  <div className="body">
                    <div>
                      <div className="name">{b.title}</div>
                      {b.author ? <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{b.author}</div> : null}
                    </div>
                    <div className="meta">
                      <Ticks done={narrated} total={b.chapterCount} ready={b.narrated ?? []} />
                      <span>
                        {narrated === 0
                          ? "Not narrated yet"
                          : narrated >= b.chapterCount
                            ? `All ${b.chapterCount} chapters ready`
                            : `${narrated} of ${b.chapterCount} ready`}
                        {cost ? ` · about ${cost}` : ""}
                      </span>
                    </div>
                  </div>
                  {started ? (
                    <svg className="ribbon" width="14" height="24" viewBox="0 0 12 20" fill="currentColor" role="img" aria-label="You've started this one">
                      <path d="M0 0h12v20l-6-5-6 5z" />
                    </svg>
                  ) : null}
                </Link>
                <button
                  className="remove"
                  style={{ position: "absolute", right: 4, bottom: 0, width: 44, height: 44, border: 0, background: "transparent", color: "var(--cream-3)", display: "flex", alignItems: "center", justifyContent: "center" }}
                  aria-label={`Remove ${b.title}`}
                  onClick={() => void remove(b.id, b.title)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            );
          })}
          <Link href="/add" className="add-row">
            <Icon name="add" size={22} />
            Add a fic
          </Link>
        </div>
      </section>
    </main>
  );
}
