"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { HearButton } from "@/components/HearButton";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { costUsd, formatUsd } from "@/lib/narrators-shared";
import type { Pron } from "@/lib/pronunciation";
import type { StaleChapter } from "@/lib/pronunciation-store";

type Data = { lines: Pron[]; list: { id: string; name: string; lines: Pron[] } | null; stale: StaleChapter[] };

export default function PronunciationPage() {
  const { id } = useParams<{ id: string }>();
  const p = usePlayer();
  const dialog = useDialog();
  const voice = p.library.find((b) => b.id === id)?.voice;
  const [lines, setLines] = useState<Pron[]>([]);
  const [stale, setStale] = useState<StaleChapter[]>([]);
  const [list, setList] = useState<Data["list"]>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const apply = useCallback((d: Data) => {
    setLines(d.lines);
    setStale(d.stale);
    setList(d.list);
    setDirty(false);
  }, []);

  useEffect(() => {
    fetch(`/api/books/${id}/pronunciation`)
      .then(async (r) => {
        const d = (await r.json()) as Data & { error?: string };
        if (!r.ok) throw new Error(d.error ?? "Couldn't load the list.");
        apply(d);
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the list."));
  }, [id, apply]);

  async function call(method: "PUT" | "POST", body: unknown, done: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch(`/api/books/${id}/pronunciation`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as Data & { error?: string };
      if (!r.ok) throw new Error(d.error ?? "That didn't work.");
      apply(d);
      setMessage(done);
      await p.refreshLibrary();
      await p.refreshBook(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  const edit = (i: number, patch: Partial<Pron>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  // Chapters ticked for re-reading; every affected chapter starts ticked.
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const picked = stale.filter((c) => !skip.has(c.index));
  const staleChars = picked.reduce((n, c) => n + c.chars, 0);

  return (
    <main className="screen no-tabs" style={{ paddingBottom: 140 }}>
      <div className="topbar">
        <Link href={`/book/${id}/narrating`} className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
      </div>
      <div className="eyebrow" style={{ marginTop: 6 }}>This fic</div>
      <h1 className="title" style={{ marginTop: 6 }}>How to say things</h1>
      <p className="lead" style={{ marginTop: 14 }}>
        Add a name or word and how it should sound. Spell it the way you&apos;d want it read, like &ldquo;Sirius&rdquo; → &ldquo;SEER-ee-us&rdquo;.
        New chapters use these; chapters already narrated keep the voice they have, so nothing is spent.
      </p>

      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="faint" role="status">{message}</p> : null}

      {list ? (
        <section className="section" aria-label="Copied list">
          <div className="eyebrow">List copied into this fic</div>
          <p className="serif" style={{ fontSize: 17, margin: "8px 0 4px" }}>
            {list.name} <span className="faint">· {list.lines.length} line{list.lines.length === 1 ? "" : "s"}</span>
          </p>
          <p className="faint" style={{ lineHeight: 1.5 }}>
            This is the copy made when the fic was added. Your own lines below win over it.
          </p>
          <button
            className="btn"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={async () => {
              if (
                await dialog.confirm({
                  title: `Copy "${list.name}" in again?`,
                  body: "Chapters not narrated yet use it. Chapters already narrated keep their audio; re-reading them with the update costs money and you'll see the price first.",
                  confirmLabel: "Update from list",
                })
              ) {
                void call("POST", { action: "updateFromList" }, "Updated from the list.");
              }
            }}
          >
            Update from list
          </button>
        </section>
      ) : null}

      {loaded ? (
        <section className="section" aria-label="Pronunciation lines">
          <div className="pron-rows">
            {lines.map((l, i) => (
              <div key={i} className="pron-row">
                <input className="select" aria-label="Written as" placeholder="Written" value={l.from} onChange={(e) => edit(i, { from: e.target.value })} />
                <input className="select" aria-label="Said as" placeholder="Said like" value={l.to} onChange={(e) => edit(i, { to: e.target.value })} />
                <HearButton text={l.to} voice={voice} />
                <button className="icon-btn" aria-label="Remove line" onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true); }}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setLines([...lines, { from: "", to: "" }]); setDirty(true); }}>
            <Icon name="add" size={18} />Add a line
          </button>
        </section>
      ) : null}

      {stale.length > 0 ? (
        <section className="section" aria-label="Chapters still using older pronunciations">
          <div className="eyebrow">Already narrated</div>
          <p className="faint" style={{ lineHeight: 1.5, marginTop: 8 }}>
            These narrated chapters were read with older pronunciations. Tick the ones to read again; each costs money,
            so skip the long ones if you like.
          </p>
          <div className="rows">
            {stale.map((c) => (
              <label key={c.index} className="chrow" style={{ minHeight: 52 }}>
                <input
                  type="checkbox"
                  checked={!skip.has(c.index)}
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) next.delete(c.index);
                    else next.add(c.index);
                    setSkip(next);
                  }}
                />
                <span className="nm">{c.title}</span>
                <span className="st">{formatUsd(costUsd(c.chars, voice))}</span>
              </label>
            ))}
          </div>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            disabled={busy || picked.length === 0}
            onClick={async () => {
              if (await dialog.confirm({ title: `Re-read ${picked.length} chapter${picked.length === 1 ? "" : "s"}?`, body: `They'll be narrated again when you play them, about ${formatUsd(costUsd(staleChars, voice))}.`, confirmLabel: "Re-read" })) {
                void call("POST", { chapters: picked.map((c) => c.index) }, "Those chapters will be read again with the new pronunciations when you play them.");
              }
            }}
          >
            Re-read {picked.length} chapter{picked.length === 1 ? "" : "s"} · about {formatUsd(costUsd(staleChars, voice))}
          </button>
        </section>
      ) : null}

      <div className="sticky-actions">
        <button className="btn primary" disabled={busy || !dirty} onClick={() => void call("PUT", { lines }, "Saved.")}>
          Save
        </button>
      </div>
    </main>
  );
}
