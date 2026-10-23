"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { costUsd, formatUsd, narratorLabel } from "@/lib/narrators-shared";
import type { PronLists } from "@/lib/pronunciation/pronlists";
import { pronunciationListsOrEmpty } from "@/lib/client/api";
import { NarratorOptions } from "./NarratorOptions";

type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string };
export type RereadItem = { index: number; title: string; chars: number };
export type RereadRequest = { bookId: string; items: RereadItem[] };

type DialogApi = {
  /** An in-app replacement for window.confirm. */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** An in-app replacement for window.alert. */
  notify: (title: string, body?: string) => Promise<void>;
  /** The form for narrating a chapter again (list, voice, then "Narrate"). */
  reread: (req: RereadRequest) => void;
};

const Ctx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDialog needs a DialogProvider");
  return ctx;
}

type Pending = ConfirmOptions & { alertOnly: boolean; resolve: (ok: boolean) => void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [rereadReq, setRereadReq] = useState<RereadRequest | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...opts, alertOnly: false, resolve })),
    [],
  );
  const notify = useCallback(
    (title: string, body?: string) =>
      new Promise<void>((resolve) =>
        setPending({ title, body, confirmLabel: "OK", alertOnly: true, resolve: () => resolve() }),
      ),
    [],
  );
  const reread = useCallback((req: RereadRequest) => setRereadReq(req), []);

  return (
    <Ctx.Provider value={{ confirm, notify, reread }}>
      {children}
      {pending ? <ConfirmModal pending={pending} close={(ok) => { pending.resolve(ok); setPending(null); }} /> : null}
      {rereadReq ? <RereadModal req={rereadReq} close={() => setRereadReq(null)} /> : null}
    </Ctx.Provider>
  );
}

function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function ConfirmModal({ pending, close }: { pending: Pending; close: (ok: boolean) => void }) {
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => yes.current?.focus(), []);
  useEscape(() => close(false));
  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title" className="serif">{pending.title}</h2>
        {pending.body ? <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>{pending.body}</p> : null}
        <div className="modal-actions">
          <button ref={yes} className="btn primary" onClick={() => close(true)}>
            {pending.confirmLabel ?? "OK"}
          </button>
          {pending.alertOnly ? null : (
            <button className="btn" onClick={() => close(false)}>{pending.cancelLabel ?? "Cancel"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function RereadModal({ req, close }: { req: RereadRequest; close: () => void }) {
  const p = usePlayer();
  const groups = useNarrators();
  const summary = p.library.find((b) => b.id === req.bookId);
  const bookVoice = summary?.voice;
  const many = req.items.length > 1;
  // With several chapters the voice shown is the fic's; each chapter keeps its own unless you change it.
  const chapterVoice = (!many && p.book?.id === req.bookId ? p.book.chapterVoices?.[req.items[0].index] : undefined) ?? bookVoice;
  const totalChars = req.items.reduce((n, c) => n + c.chars, 0);

  const [lists, setLists] = useState<PronLists>({ lists: [] });
  const [listId, setListId] = useState("keep");
  const [voice, setVoice] = useState(chapterVoice ?? "");
  const [forBook, setForBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscape(() => !busy && close());

  useEffect(() => {
    void pronunciationListsOrEmpty().then(setLists);
  }, []);

  const price = formatUsd(costUsd(totalChars, voice));
  const changedVoice = voice !== (chapterVoice ?? "");

  async function narrate() {
    setBusy(true);
    setError("");
    const opts = { listId, voice: changedVoice ? voice : undefined, voiceForBook: changedVoice && forBook };
    const message = many
      ? await p.rereadMany(req.bookId, req.items.map((c) => c.index), opts)
      : await p.rereadAndNarrate(req.bookId, req.items[0].index, opts);
    if (message) {
      setError(message);
      setBusy(false);
    } else {
      close();
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reread-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="reread-title" className="serif">{many ? `Narrate ${req.items.length} chapters again` : "Narrate this chapter again"}</h2>
        <p className="lead-sm">{many ? `${req.items[0].title} and ${req.items.length - 1} more` : req.items[0].title}</p>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          {many
            ? "Their current narration is thrown away and they're narrated again in the background. Follow it in the Queue."
            : "The current narration is thrown away. If you're listening to this chapter, it stops."}
        </p>

        <label className="label" htmlFor="rr-list" style={{ display: "block", marginTop: 18 }}>Pronunciations</label>
        <select id="rr-list" className="select wide" value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="keep">Keep this fic&apos;s current</option>
          <option value="none">No list</option>
          {lists.lists.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <label className="label" htmlFor="rr-voice" style={{ display: "block", marginTop: 14 }}>Voice</label>
        <select id="rr-voice" className="select wide" value={voice} onChange={(e) => setVoice(e.target.value)}>
          <NarratorOptions groups={groups} keep={chapterVoice} markKept />
        </select>

        {changedVoice ? (
          <label className="faint" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, minHeight: 44 }}>
            <input type="checkbox" checked={forBook} onChange={(e) => setForBook(e.target.checked)} />
            Use {narratorLabel(voice)} for the whole fic from now on
          </label>
        ) : null}

        <p className="muted" style={{ marginTop: 14, lineHeight: 1.5 }}>
          {many ? "Together they cost" : "Costs"} about {price} with {narratorLabel(voice)}. It&apos;s saved afterwards, so listening again is free.
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}

        <div className="modal-actions">
          <button className="btn primary" disabled={busy} onClick={() => void narrate()}>
            {busy ? "Starting…" : many ? `Narrate ${req.items.length} chapters` : "Narrate"}
          </button>
          <button className="btn" disabled={busy} onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
