"use client";

import { memo } from "react";
import type { Para } from "@/lib/reader/types";

export type ParaSentence = { gi: number; a: number; b: number };

/** One paragraph, cut into spans at every sentence and style change; the spoken sentence is lit. */
export const Passage = memo(function Passage({
  para,
  sentences,
  active,
}: {
  para: Para;
  sentences: ParaSentence[];
  /** Global index of the sentence being spoken if it is in this paragraph, else -1. */
  active: number;
}) {
  if (para.kind === "break") {
    return (
      <div className="rd-break" aria-hidden="true">
        · · ·
      </div>
    );
  }
  const cls =
    para.kind === "quote" ? "rd-p rd-quote" : para.kind === "heading" ? "rd-p rd-title" : "rd-p";
  const out: React.ReactNode[] = [];
  let at = 0;
  para.runs.forEach((run, ri) => {
    let from = 0;
    const end = at + run.t.length;
    // Sentences overlapping this run, cut at their edges.
    while (from < run.t.length) {
      const pos = at + from;
      const s = sentences.find((x) => pos >= x.a && pos < x.b);
      const next = sentences.find((x) => x.a > pos);
      const stop = Math.min(end, s ? s.b : (next?.a ?? end));
      const piece = run.t.slice(from, stop - at);
      const names = [run.i ? "i" : "", run.b ? "b" : "", s && s.gi === active ? "on" : ""]
        .filter(Boolean)
        .join(" ");
      out.push(
        <span key={`${ri}-${from}`} data-s={s?.gi} className={names || undefined}>
          {piece}
        </span>,
      );
      from = stop - at;
    }
    at = end;
  });
  return <p className={cls}>{out}</p>;
});
