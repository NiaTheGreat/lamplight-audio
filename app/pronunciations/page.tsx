"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import type { PronLists } from "@/lib/pronlists";

export default function PronunciationLists() {
  const dialog = useDialog();
  const [data, setData] = useState<PronLists | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/pronunciation-lists")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("Couldn't load your lists."));
  }, []);

  if (!data) {
    return <main className="screen no-tabs">{error ? <p className="error">{error}</p> : <p className="empty">Opening…</p>}</main>;
  }

  const set = (next: PronLists) => {
    setData(next);
    setDirty(true);
    setMessage("");
  };
  const update = (i: number, patch: Partial<PronLists["lists"][number]>) =>
    set({ ...data, lists: data.lists.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/pronunciation-lists", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Couldn't save.");
      setData((await r.json()) as PronLists);
      setDirty(false);
      setMessage("Saved. Fics already added keep their own copy.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen no-tabs" style={{ paddingBottom: 140 }}>
      <div className="topbar">
        <Link href="/settings" className="icon-btn" aria-label="Back"><Icon name="back" /></Link>
      </div>
      <div className="eyebrow" style={{ marginTop: 6 }}>Settings</div>
      <h1 className="title" style={{ marginTop: 6 }}>Pronunciation lists</h1>
      <p className="lead" style={{ marginTop: 14 }}>
        Pick a list when you add a fic, or mark one automatic. The list is copied into the fic, so editing it here only affects fics you add afterwards.
      </p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="faint" role="status">{message}</p> : null}

      {data.lists.map((l, i) => (
        <section key={l.id} className="section" aria-label={l.name}>
          <div className="pron-row" style={{ gridTemplateColumns: "1fr 44px" }}>
            <input className="select" aria-label="List name" value={l.name} onChange={(e) => update(i, { name: e.target.value })} />
            <button
              className="icon-btn"
              aria-label={`Delete ${l.name}`}
              onClick={async () => {
                if (await dialog.confirm({ title: `Delete "${l.name}"?`, body: "Fics that already copied it keep their copy.", confirmLabel: "Delete" })) {
                  set({ lists: data.lists.filter((_, j) => j !== i), auto: data.auto === l.id ? undefined : data.auto });
                }
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
          <label className="faint" style={{ display: "flex", gap: 10, alignItems: "center", margin: "10px 0", minHeight: 44 }}>
            <input
              type="checkbox"
              checked={data.auto === l.id}
              onChange={(e) => set({ ...data, auto: e.target.checked ? l.id : undefined })}
            />
            Use for every new fic
          </label>
          <div className="pron-rows">
            {l.lines.map((line, k) => (
              <div key={k} className="pron-row">
                <input className="select" aria-label="Written as" placeholder="Written" value={line.from}
                  onChange={(e) => update(i, { lines: l.lines.map((x, j) => (j === k ? { ...x, from: e.target.value } : x)) })} />
                <input className="select" aria-label="Said as" placeholder="Said like" value={line.to}
                  onChange={(e) => update(i, { lines: l.lines.map((x, j) => (j === k ? { ...x, to: e.target.value } : x)) })} />
                <button className="icon-btn" aria-label="Remove line" onClick={() => update(i, { lines: l.lines.filter((_, j) => j !== k) })}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => update(i, { lines: [...l.lines, { from: "", to: "" }] })}>
            <Icon name="add" size={18} />Add a line
          </button>
        </section>
      ))}

      <button
        className="btn"
        style={{ marginTop: 22 }}
        onClick={() => set({ ...data, lists: [...data.lists, { id: "", name: "New list", lines: [] }] })}
      >
        <Icon name="add" size={18} />New list
      </button>

      <div className="sticky-actions">
        <button className="btn primary" disabled={busy || !dirty} onClick={() => void save()}>Save</button>
      </div>
    </main>
  );
}
