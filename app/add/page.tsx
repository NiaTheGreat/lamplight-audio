"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PronLists } from "@/lib/pronunciation/pronlists";
import { pronunciationListsOrEmpty } from "@/lib/client/api";
import { NarratorOptions } from "@/components/NarratorOptions";
import { Icon } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import type { BookSummary } from "@/lib/types";

function describeFailure(status: number, serverMessage: string | undefined, body: string, file: File): string {
  if (serverMessage) return serverMessage;
  const mb = (file.size / 1_000_000).toFixed(1);
  if (status === 413) {
    return `That file is ${mb} MB, which is too big for the server to accept (the limit is about 4.5 MB).`;
  }
  if (status === 401) return "You've been signed out. Reload the page and log in again.";
  if (status === 504 || status === 408) return "The upload took too long and timed out. Try again, or try a smaller file.";
  const snippet = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `Upload failed (${status}${snippet ? `: ${snippet}` : ""}). The file was ${mb} MB.`;
}

export default function AddFic() {
  const router = useRouter();
  const p = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [skipNotes, setSkipNotes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const groups = useNarrators();
  // Starts at the narrator chosen in Settings; changing it here only affects this book.
  const [voice, setVoice] = useState(p.settings.voice);
  const voiceTouched = useRef(false);
  // "" = the automatic list (if any); "none" = no list.
  const [lists, setLists] = useState<PronLists>({ lists: [] });
  const [listChoice, setListChoice] = useState("");
  useEffect(() => {
    void pronunciationListsOrEmpty().then(setLists);
  }, []);
  useEffect(() => {
    if (!voiceTouched.current) setVoice(p.settings.voice);
  }, [p.settings.voice]);

  function chooseFile(file: File | undefined) {
    if (!file) return;
    if (!/\.epub$/i.test(file.name) && file.type !== "application/epub+zip") {
      setError("That doesn't look like an EPUB. On AO3, use Download, then EPUB.");
      return;
    }
    void upload(file);
  }

  // Vercel rejects request bodies over ~4.5 MB, so bigger files go straight to storage.
  const DIRECT_LIMIT = 4_000_000;

  /** Send the file to the server in the body (small files, or when there's no bucket). */
  async function postFile(file: File): Promise<Response> {
    const form = new FormData();
    form.append("file", file);
    form.append("skipNotes", String(skipNotes));
    form.append("voice", voice);
    if (listChoice) form.append("pronList", listChoice);
    return fetch("/api/books", { method: "POST", body: form });
  }

  /** Upload straight to storage, then tell the server which file to read. */
  async function postViaStorage(file: File): Promise<Response | null> {
    const ask = await fetch("/api/uploads", { method: "POST" });
    const slot = (await ask.json().catch(() => null)) as { direct?: boolean; key?: string; url?: string } | null;
    if (!ask.ok || !slot) throw new Error("Couldn't start the upload. Reload the page and try again.");
    if (slot.direct || !slot.key || !slot.url) return null; // no bucket: use the normal path
    let put: Response;
    try {
      put = await fetch(slot.url, { method: "PUT", body: file });
    } catch {
      throw new Error(
        "Couldn't upload to storage. If this keeps happening, the bucket's CORS setting probably doesn't allow this site.",
      );
    }
    if (!put.ok) throw new Error(`Storage refused the upload (${put.status}).`);
    return fetch("/api/books", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadKey: slot.key, skipNotes, voice, pronList: listChoice || undefined }),
    });
  }

  async function upload(file: File) {
    setError("");
    setBusy(true);
    try {
      const res = (file.size > DIRECT_LIMIT ? await postViaStorage(file) : null) ?? (await postFile(file));
      // The host can answer with plain text or HTML (too large, timed out, signed out),
      // so read the text first instead of assuming JSON.
      const text = await res.text();
      let data: (BookSummary & { error?: string }) | null = null;
      try {
        data = JSON.parse(text) as BookSummary & { error?: string };
      } catch {
        /* not JSON */
      }
      if (!res.ok || !data) throw new Error(describeFailure(res.status, data?.error, text, file));
      await p.refreshLibrary();
      router.push(`/book/${data.id}/narrating`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <main
      className="screen"
      // A drop that misses the box shouldn't make the browser open the file.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <div className="eyebrow">New on the shelf</div>
      <h1 className="display">Add a fic</h1>

      <div className="section">
        <input
          ref={fileRef}
          className="hidden-input"
          type="file"
          accept=".epub,application/epub+zip"
          aria-label="Choose an EPUB file"
          tabIndex={-1}
          onChange={(e) => {
            chooseFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          className={`dropzone ${over ? "over" : ""}`}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={(e) => {
            // Ignore leaves into the button's own children.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!busy) chooseFile(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="book" size={44} stroke={1.25} />
          <span className="big">{busy ? "Reading your EPUB…" : over ? "Drop it here" : "Choose an EPUB"}</span>
          <span className="muted" style={{ maxWidth: 250, lineHeight: 1.45 }}>
            On AO3, open the work and use Download, then EPUB. Then pick the file here, or drop it on this box.
          </span>
        </button>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>

      <div style={{ marginTop: 14 }} className="soft-row" aria-disabled="true">
        <Icon name="link" size={22} />
        <span style={{ flexGrow: 1, fontSize: 15 }}>Paste an AO3 link</span>
        <span className="tag">Soon</span>
      </div>

      <div className="section">
        <div className="eyebrow">While reading it aloud</div>
        <div className="option">
          <div className="grow">
            <div className="label">Skip author&apos;s notes and summaries</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
              Only the story is read. The first words of each chapter are its title.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={skipNotes}
            aria-label="Skip author's notes and summaries"
            className="switch"
            onClick={() => setSkipNotes((v) => !v)}
          />
        </div>
      </div>

      <div className="section">
        <div className="option">
          <div className="grow">
            <label className="label" htmlFor="voice">Narrator</label>
            <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
              This fic keeps it from now on. Hear the voices in Settings.
            </div>
          </div>
          <select
            id="voice"
            className="select"
            value={voice}
            onChange={(e) => {
              voiceTouched.current = true;
              setVoice(e.target.value);
            }}
          >
            <NarratorOptions groups={groups} />
          </select>
        </div>
      </div>

      {lists.lists.length > 0 ? (
        <div className="section">
          <div className="option">
            <div className="grow">
              <label className="label" htmlFor="pronlist">Pronunciations</label>
              <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
                A copy of the list goes into this fic. Changing the list later won&apos;t touch it.
              </div>
            </div>
            <select id="pronlist" className="select" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
              <option value="">
                {lists.auto ? `Automatic: ${lists.lists.find((l) => l.id === lists.auto)?.name}` : "None"}
              </option>
              {lists.auto ? <option value="none">None</option> : null}
              {lists.lists.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 22, display: "flex", gap: 12, color: "var(--cream-2)", fontSize: 13, lineHeight: 1.5 }}>
        <Icon name="moon" size={18} />
        <span>Narration is made once and kept, so listening again never costs anything.</span>
      </div>
    </main>
  );
}
