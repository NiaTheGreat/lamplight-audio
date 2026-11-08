import type { Para, Run } from "./types";

// Private-use characters that carry formatting through the text pipeline in lib/epub.ts.
export const I_ON = "";
export const I_OFF = "";
export const B_ON = "";
export const B_OFF = "";
export const Q_ON = "";
export const Q_OFF = "";
export const HR = "";
export const MARK_RE = /[-]/g;

export const paraText = (p: Para): string => p.runs.map((r) => r.t).join("");

/** The narrated text of a chapter: its paragraphs (scene breaks left out) joined by a blank line. */
export const chapterText = (paras: Para[]): string =>
  paras
    .filter((p) => p.kind !== "break")
    .map(paraText)
    .join("\n\n");

/** Paragraphs with no formatting, for text we can't format (or books added before the reader). */
export function plainParas(text: string): Para[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((t) => ({ runs: [{ t }] }));
}

function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && !last.i === !r.i && !last.b === !r.b) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

/**
 * Turn the marked-up, normalised text from `extractChapter` into paragraphs. Returns null when
 * the result would not read exactly as `plain` (the narrated text); the caller then falls back to
 * plain paragraphs, so formatting can never change what the page says.
 */
export function parseMarked(marked: string, plain: string): Para[] | null {
  let it = 0;
  let bd = 0;
  let q = 0;
  const paras: Para[] = [];
  for (const chunk of marked.split(/\n{2,}/)) {
    let inQuote = false;
    let seenText = false;
    let runs: Run[] = [];
    let buf = "";
    let hasHr = false;
    const flush = () => {
      if (buf)
        runs.push({
          t: buf,
          ...(it > 0 ? { i: true as const } : {}),
          ...(bd > 0 ? { b: true as const } : {}),
        });
      buf = "";
    };
    for (const ch of chunk) {
      switch (ch) {
        case I_ON:
          flush();
          it++;
          break;
        case I_OFF:
          flush();
          it = Math.max(0, it - 1);
          break;
        case B_ON:
          flush();
          bd++;
          break;
        case B_OFF:
          flush();
          bd = Math.max(0, bd - 1);
          break;
        case Q_ON:
          q++;
          break;
        case Q_OFF:
          q = Math.max(0, q - 1);
          break;
        case HR:
          hasHr = true;
          break;
        default:
          if (!seenText && /\S/.test(ch)) {
            seenText = true;
            inQuote = q > 0;
          }
          buf += ch;
      }
    }
    flush();
    runs = merge(runs);
    if (runs.length) {
      runs[0].t = runs[0].t.replace(/^\s+/, "");
      runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, "");
      runs = runs.filter((r) => r.t);
    }
    if (runs.length === 0) {
      if (hasHr) paras.push({ runs: [], kind: "break" });
      continue;
    }
    paras.push({ runs, ...(inQuote ? { kind: "quote" as const } : {}) });
  }
  // Collapse repeated breaks and breaks at the very start or end.
  const cleaned = paras.filter(
    (p, i) =>
      p.kind !== "break" || (i > 0 && i < paras.length - 1 && paras[i - 1].kind !== "break"),
  );
  return chapterText(cleaned) === plain ? cleaned : null;
}

/** Put the chapter title that was prepended for narration in front, as a heading paragraph. */
export function withTitle(spoken: string, text: string, paras: Para[]): Para[] {
  if (spoken === text) return paras;
  if (!spoken.endsWith(text)) return plainParas(spoken);
  const title = spoken.slice(0, spoken.length - text.length).trim();
  return title ? [{ runs: [{ t: title }], kind: "heading" }, ...paras] : paras;
}
