"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HearButton } from "@/components/HearButton";
import { usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import type { PronLists } from "@/lib/pronlists";
import { getPronunciationLists, savePronunciationLists } from "@/lib/client/api";
import { NarratorOptions } from "@/components/NarratorOptions";

export default function PronunciationLists() {
  const dialog = useDialog();
  const p = usePlayer();
  const groups = useNarrators();
  const [chosenVoice, setChosenVoice] = useState("");
  const testVoice = chosenVoice || p.settings.voice;
  const [data, setData] = useState<PronLists | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getPronunciationLists()
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
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      setData(await savePronunciationLists(data));
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

      <label className="label" htmlFor="test-voice" style={{ display: "block", marginTop: 18 }}>Voice for the Hear buttons</label>
      <select id="test-voice" className="select wide" value={testVoice} onChange={(e) => setChosenVoice(e.target.value)}>
        <NarratorOptions groups={groups} showPrice={false} hideKeyHint />
      </select>

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
                <HearButton text={line.to} voice={testVoice} />
                <button className="icon-btn" aria-label="Remove line" onClick={() => update(i, { lines: l.lines.filter((_, j) => j !== k) })}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => update(i, { lines: [...l.lines, { from: "", to: "" }] })}>
            <Icon name="add" size={18} />Add a line
          </button>
          <p className="faint" style={{ marginTop: 10, lineHeight: 1.5 }}>
            Kokoro works best with one lowercase word and no hyphens or capitals, like <em>rejeena</em> for Regina. Use the Hear button to try it.
          </p>
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
