import type { Para } from "./types";
import { paraText } from "./format";

export type Sentence = {
  /** Index of the paragraph in `paras`. */
  p: number;
  /** Character range inside that paragraph's text. */
  a: number;
  b: number;
  /** Offset of the sentence start in the chapter text (paragraphs joined by a blank line). */
  off: number;
};

const ABBREVIATIONS = /(?:^|[\s"“(])(?:mr|mrs|ms|dr|st|jr|sr|mt|vs|prof|capt|col|gen|lt|sgt|no)$/i;

/** Sentence ranges of one paragraph's text. */
export function sentenceRanges(text: string): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  const re = /[.!?…]+["”’')\]]*(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (m[0] === "." && ABBREVIATIONS.test(text.slice(start, m.index))) continue;
    out.push({ a: start, b: end });
    start = end;
    while (start < text.length && /\s/.test(text[start])) start++;
    re.lastIndex = Math.max(re.lastIndex, start);
  }
  if (start < text.length) out.push({ a: start, b: text.length });
  return out;
}

/** Every sentence of a chapter, in reading order. Scene breaks have none. */
export function splitSentences(paras: Para[]): Sentence[] {
  const out: Sentence[] = [];
  let base = 0;
  paras.forEach((para, p) => {
    if (para.kind === "break") return;
    const text = paraText(para);
    for (const r of sentenceRanges(text)) out.push({ p, a: r.a, b: r.b, off: base + r.a });
    base += text.length + 2;
  });
  return out;
}

/** Index of the last sentence starting at or before `t` (0 if before the first). */
export function sentenceAt(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
