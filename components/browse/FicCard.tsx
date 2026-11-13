"use client";

import { Icon } from "@/components/Icon";
import { isComplete } from "@/lib/catalog/filter";
import type { CatalogItem } from "@/lib/catalog/meta";
import type { ReadState } from "@/lib/catalog/readstate";
import { costUsd, formatUsd } from "@/lib/narrators-shared";
import type { LibraryEntry } from "@/lib/types";

export const fmt = (n: number) => n.toLocaleString("en-US");

/** "Chapter 12 of 24", with a thin bar; or Unread / Finished. */
export function ReadBadge({ state }: { state: ReadState }) {
  if (state.kind === "finished") {
    return (
      <div className="bw-read fin">
        <span className="bw-state fin">
          <Icon name="check" size={12} stroke={2} /> FINISHED
        </span>
      </div>
    );
  }
  if (state.kind === "reading") {
    return (
      <div className="bw-read">
        <span className="bw-state reading">READING</span>
        <span>
          Chapter {state.chapter + 1} of {state.total}
        </span>
        <span className="bw-bar" aria-hidden="true">
          <i style={{ width: `${((state.chapter + 1) / Math.max(1, state.total)) * 100}%` }} />
        </span>
      </div>
    );
  }
  return (
    <div className="bw-read">
      <span className="bw-state un">UNREAD</span>
    </div>
  );
}

export function statsLine(item: CatalogItem): string[] {
  const out = [`${fmt(item.words)} words`];
  out.push(
    item.source === "ao3-preface"
      ? `${item.chapters}/${item.chaptersTotal ?? "?"} chapters`
      : `${item.chapters} chapter${item.chapters === 1 ? "" : "s"}`,
  );
  if (item.updated) out.push(`updated ${item.updated}`);
  if (item.language) out.push(item.language);
  return out;
}

/** Price of narrating what's left of a fic, in its narrator's voice. */
export function narrateCost(item: CatalogItem, shelf: LibraryEntry | undefined, voice: string) {
  let chars = item.chars;
  if (shelf?.chars) {
    const done = new Set(shelf.narrated ?? []);
    chars = shelf.chars.reduce((sum, n, i) => (done.has(i) ? sum : sum + n), 0);
  }
  return chars > 0 ? costUsd(chars, shelf?.voice ?? voice) : 0;
}

export function FicCard({
  item,
  state,
  shelf,
  voice,
  reader,
  onOpen,
  onRead,
  onNarrate,
  onListen,
}: {
  item: CatalogItem;
  state: ReadState;
  shelf?: LibraryEntry;
  voice: string;
  reader: boolean;
  onOpen: () => void;
  onRead: () => void;
  onNarrate: () => void;
  onListen: () => void;
}) {
  const narrated = shelf?.narrated?.length ?? 0;
  const complete = isComplete(item);
  const tags = [...(item.userTags ?? []), ...(item.tags ?? [])];
  const shownTags = tags.slice(0, 6);
  const cost = narrateCost(item, shelf, voice);
  const readLabel =
    state.kind === "reading"
      ? `Continue · ch ${state.chapter + 1}`
      : state.kind === "finished"
        ? "Read again"
        : "Read";

  return (
    <article className="bw-card">
      {narrated > 0 ? (
        <svg
          className="ribbon"
          width="14"
          height="24"
          viewBox="0 0 12 20"
          fill="currentColor"
          role="img"
          aria-label="On your shelf"
        >
          <path d="M0 0h12v20l-6-5-6 5z" />
        </svg>
      ) : null}
      <h2 className="bw-title">
        <button onClick={onOpen}>{item.title}</button>
      </h2>
      {item.author ? <div className="bw-by">by {item.author}</div> : null}

      <div className="bw-pills">
        {item.rating ? <span className="bw-pill">{item.rating}</span> : null}
        {complete === true ? <span className="bw-pill done">Complete</span> : null}
        {complete === false ? <span className="bw-pill wip">In progress</span> : null}
        {(item.category ?? []).map((c) => (
          <span key={c} className="bw-pill">
            {c}
          </span>
        ))}
      </div>
      {item.fandoms?.length ? <div className="bw-fandom">{item.fandoms.join(" · ")}</div> : null}
      {item.relationships?.length ? (
        <div className="bw-ship">{item.relationships.slice(0, 2).join(" · ")}</div>
      ) : null}
      {item.summary ? <p className="bw-sum">{item.summary}</p> : null}
      {shownTags.length ? (
        <div className="bw-tags">
          {shownTags.map((t) => (
            <span key={t} className="bw-tag">
              {t}
            </span>
          ))}
          {tags.length > shownTags.length ? (
            <button className="bw-tag more" onClick={onOpen}>
              + {tags.length - shownTags.length} more
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="bw-stats">
        {statsLine(item).map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <ReadBadge state={state} />
      <div className="bw-acts">
        {reader ? (
          <button className="btn" onClick={onRead}>
            {readLabel}
          </button>
        ) : null}
        {narrated > 0 ? (
          <button className="btn primary" onClick={onListen}>
            Listen
          </button>
        ) : (
          <button className="btn primary" onClick={onNarrate}>
            Narrate…
            {cost > 0 ? <small>about {formatUsd(cost)}</small> : null}
          </button>
        )}
      </div>
      {narrated > 0 ? (
        <div className="bw-narr">
          {narrated >= item.chapters
            ? `All ${item.chapters} chapters narrated`
            : `${narrated} of ${item.chapters} narrated`}
          {" · on your shelf"}
        </div>
      ) : null}
    </article>
  );
}
