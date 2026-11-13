"use client";

import { useEffect, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { Icon } from "@/components/Icon";
import { isComplete } from "@/lib/catalog/filter";
import { ao3WorkUrl, type CatalogItem, type ReadingEntry } from "@/lib/catalog/meta";
import type { ReadState } from "@/lib/catalog/readstate";
import { editFic, getBook, getFullSummary, removeFic, saveReading } from "@/lib/client/api";
import { formatUsd } from "@/lib/narrators-shared";
import type { BookSummary, LibraryEntry } from "@/lib/types";
import { ReadBadge, narrateCost, statsLine } from "./FicCard";

/** One fic in full: the whole summary and every tag, chapters with where you are, and hand edits. */
export function DetailSheet({
  item,
  state,
  entry,
  shelf,
  voice,
  reader,
  onClose,
  onChanged,
  onRead,
  onNarrate,
  onListen,
}: {
  item: CatalogItem;
  state: ReadState;
  entry?: ReadingEntry;
  shelf?: LibraryEntry;
  voice: string;
  reader: boolean;
  onClose: () => void;
  /** Something about the fic changed (tags, finished, removed): reload the list. */
  onChanged: () => void;
  onRead: (chapter: number) => void;
  onNarrate: () => void;
  onListen: () => void;
}) {
  const dialog = useDialog();
  const [summary, setSummary] = useState<string | null>(null);
  const [book, setBook] = useState<BookSummary | null>(null);
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getFullSummary(item.id).then((s) => alive && setSummary(s));
    void getBook(item.id).then((b) => alive && setBook(b));
    return () => {
      alive = false;
    };
  }, [item.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const complete = isComplete(item);
  const done = new Set(entry?.done ?? []);
  const narrated = shelf?.narrated?.length ?? 0;
  const cost = narrateCost(item, shelf, voice);

  async function change(run: () => Promise<unknown>) {
    setBusy(true);
    try {
      await run();
      onChanged();
    } catch (err) {
      await dialog.notify("Couldn't save that", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  const addTag = () => {
    const t = tagText.trim();
    if (!t) return;
    setTagText("");
    void change(() => editFic(item.id, { userTags: [...(item.userTags ?? []), t] }));
  };

  async function remove() {
    const ok = await dialog.confirm({
      title: `Remove "${item.title}" from your library?`,
      body: "It leaves Browse and your shelf. Narration already made is kept, and adding the same EPUB again brings it back.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await change(async () => {
      await removeFic(item.id);
      onClose();
    });
  }

  const group = (label: string, list?: string[]) =>
    list?.length ? (
      <div className="bw-detail-group">
        <div className="eyebrow">{label}</div>
        <div className="bw-tags">
          {list.map((t) => (
            <span key={t} className="bw-tag">
              {t}
            </span>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="bw-sheet-back" onClick={onClose}>
      <div
        className="bw-sheet detail"
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bw-grab" aria-hidden="true" />
        <button className="icon-btn bw-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="bw-scroll">
          {item.fandoms?.length ? <div className="eyebrow">{item.fandoms.join(" · ")}</div> : null}
          <h2 className="bw-dtitle">{item.title}</h2>
          {item.author ? <div className="bw-by">by {item.author}</div> : null}
          <div className="bw-pills">
            {item.rating ? <span className="bw-pill">{item.rating}</span> : null}
            {complete === true ? <span className="bw-pill done">Complete</span> : null}
            {complete === false ? <span className="bw-pill wip">In progress</span> : null}
            {item.series ? <span className="bw-pill">{item.series}</span> : null}
          </div>
          <div className="bw-stats">
            {statsLine(item).map((s) => (
              <span key={s}>{s}</span>
            ))}
            {item.published ? <span>published {item.published}</span> : null}
          </div>
          <ReadBadge state={state} />

          {summary || item.summary ? (
            <p className="bw-dsum">{summary ?? item.summary}</p>
          ) : (
            <p className="faint">This file has no summary.</p>
          )}
          {group("Warnings", item.warnings)}
          {group("Relationships", item.relationships)}
          {group("Characters", item.characters)}
          {group("Tags", item.tags)}

          <div className="bw-detail-group">
            <div className="eyebrow">Your tags</div>
            <div className="bw-tags">
              {(item.userTags ?? []).map((t) => (
                <button
                  key={t}
                  className="bw-chip on"
                  disabled={busy}
                  onClick={() =>
                    void change(() =>
                      editFic(item.id, { userTags: (item.userTags ?? []).filter((x) => x !== t) }),
                    )
                  }
                >
                  {t} <Icon name="close" size={12} />
                </button>
              ))}
            </div>
            <div className="bw-row" style={{ marginTop: 8 }}>
              <input
                className="bw-input"
                placeholder="Add a tag"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTag()}
              />
              <button className="bw-mini" onClick={addTag} disabled={busy || !tagText.trim()}>
                Add
              </button>
            </div>
            <label
              className="eyebrow"
              htmlFor="bw-complete"
              style={{ display: "block", marginTop: 14 }}
            >
              Status
            </label>
            <select
              id="bw-complete"
              className="bw-select"
              value={item.completeOverride === undefined ? "" : String(item.completeOverride)}
              disabled={busy}
              onChange={(e) =>
                void change(() =>
                  editFic(item.id, {
                    complete: e.target.value === "" ? null : e.target.value === "true",
                  }),
                )
              }
            >
              <option value="">
                As the file says
                {item.complete === undefined
                  ? " (not stated)"
                  : item.complete
                    ? " (complete)"
                    : " (in progress)"}
              </option>
              <option value="true">Complete</option>
              <option value="false">In progress</option>
            </select>
          </div>

          <div className="bw-detail-group">
            <div className="eyebrow">Chapters</div>
            {!book ? (
              <p className="faint">Loading…</p>
            ) : (
              <ol className="bw-chaps">
                {book.chapters.map((c) => {
                  const here = state.kind === "reading" && state.chapter === c.index;
                  return (
                    <li key={c.index} className={here ? "here" : ""}>
                      <button disabled={!reader} onClick={() => onRead(c.index)}>
                        <span>
                          {done.has(c.index) ? <Icon name="check" size={14} stroke={2} /> : null}{" "}
                          {c.index + 1} · {c.title}
                        </span>
                        <span className="faint">
                          {here
                            ? "you stopped here"
                            : shelf?.narrated?.includes(c.index)
                              ? "narrated"
                              : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="bw-detail-group bw-links">
            {state.kind === "finished" ? (
              <button
                className="bw-link"
                disabled={busy}
                onClick={() => void change(() => saveReading({ id: item.id, finished: false }))}
              >
                Mark unread
              </button>
            ) : (
              <button
                className="bw-link"
                disabled={busy}
                onClick={() => void change(() => saveReading({ id: item.id, finished: true }))}
              >
                Mark finished
              </button>
            )}
            {state.kind === "reading" ? (
              <button
                className="bw-link"
                disabled={busy}
                onClick={() => void change(() => saveReading({ id: item.id, finished: false }))}
              >
                Mark unread
              </button>
            ) : null}
            {item.workId ? (
              <a
                className="bw-link"
                href={ao3WorkUrl(item.workId)}
                target="_blank"
                rel="noreferrer"
              >
                Open on AO3
              </a>
            ) : null}
            <button className="bw-link danger" disabled={busy} onClick={() => void remove()}>
              Remove from library
            </button>
          </div>
        </div>
        <div className="bw-foot">
          {reader ? (
            <button
              className="btn"
              onClick={() => onRead(state.kind === "reading" ? state.chapter : 0)}
            >
              {state.kind === "reading"
                ? `Continue · ch ${state.chapter + 1}`
                : state.kind === "finished"
                  ? "Read again"
                  : "Read"}
            </button>
          ) : null}
          {narrated > 0 ? (
            <button className="btn primary" onClick={onListen}>
              Listen
            </button>
          ) : (
            <button className="btn primary" onClick={onNarrate}>
              Narrate…{cost > 0 ? <small>about {formatUsd(cost)}</small> : null}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
