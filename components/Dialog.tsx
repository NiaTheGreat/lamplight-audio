"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { costUsd, formatUsd, narratorLabel } from "@/lib/narrators-shared";
import type { PronLists } from "@/lib/pronlists";

type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; cancelLabel?: string };
export type RereadRequest = { bookId: string; index: number; title: string; chars: number };

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
  const chapterVoice = (p.book?.id === req.bookId ? p.book.chapterVoices?.[req.index] : undefined) ?? bookVoice;

  const [lists, setLists] = useState<PronLists>({ lists: [] });
  const [listId, setListId] = useState("keep");
  const [voice, setVoice] = useState(chapterVoice ?? "");
  const [forBook, setForBook] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEscape(() => !busy && close());

  useEffect(() => {
    fetch("/api/pronunciation-lists").then((r) => (r.ok ? r.json() : { lists: [] })).then(setLists).catch(() => {});
  }, []);

  const price = formatUsd(costUsd(req.chars, voice));
  const changedVoice = voice !== (chapterVoice ?? "");

  async function narrate() {
    setBusy(true);
    setError("");
    const message = await p.rereadAndNarrate(req.bookId, req.index, {
      listId,
      voice: changedVoice ? voice : undefined,
      voiceForBook: changedVoice && forBook,
    });
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
        <h2 id="reread-title" className="serif">Narrate this chapter again</h2>
        <p className="lead-sm">{req.title}</p>
        <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          The current narration is thrown away. If you&apos;re listening to this chapter, it stops.
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
          {groups.map((g) => (
            <optgroup key={g.provider} label={`${g.label} · about ${formatUsd(g.pricePerMillion)} per million characters`}>
              {g.narrators.map((n) => (
                <option key={n.id} value={n.id} disabled={!g.configured && n.id !== chapterVoice}>
                  {n.label}{n.id === chapterVoice ? " (current)" : ""}{g.configured ? "" : " (needs a key)"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {changedVoice ? (
          <label className="faint" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, minHeight: 44 }}>
            <input type="checkbox" checked={forBook} onChange={(e) => setForBook(e.target.checked)} />
            Use {narratorLabel(voice)} for the whole fic from now on
          </label>
        ) : null}

        <p className="muted" style={{ marginTop: 14, lineHeight: 1.5 }}>
          Costs about {price} with {narratorLabel(voice)}. It&apos;s saved afterwards, so listening again is free.
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}

        <div className="modal-actions">
          <button className="btn primary" disabled={busy} onClick={() => void narrate()}>
            {busy ? "Starting…" : "Narrate"}
          </button>
          <button className="btn" disabled={busy} onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
