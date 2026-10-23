import type { Book } from "../types";

/** "Hermione" → "her-MY-oh-nee": what to say instead of what's written. */
export type Pron = { from: string; to: string };

const MAX_LINES = 300;

/** Clean up lines from a form or request: trimmed, non-empty, no duplicates (case-insensitive). */
export function sanitizeLines(input: unknown): Pron[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Pron[] = [];
  for (const item of input) {
    const from = typeof item?.from === "string" ? item.from.trim().slice(0, 80) : "";
    const to = typeof item?.to === "string" ? item.to.trim().slice(0, 120) : "";
    if (!from || !to || seen.has(from.toLowerCase())) continue;
    seen.add(from.toLowerCase());
    out.push({ from, to });
    if (out.length >= MAX_LINES) break;
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Swap whole words (any case) for how they should be said. One pass, longest first, so a
 * replacement is never itself replaced. With no lines the text comes back untouched, which keeps
 * the cache keys of books without pronunciations exactly as they were.
 */
export function applyPronunciations(text: string, lines: Pron[] | undefined): string {
  if (!lines || lines.length === 0) return text;
  const map = new Map(lines.map((l) => [l.from.toLowerCase(), l.to]));
  const pattern = [...map.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`, "giu");
  return text.replace(re, (m) => map.get(m.toLowerCase()) ?? m);
}

/** The copied list's lines first, then the fic's own, which win when both cover the same word. */
export function effectiveLines(book: Pick<Book, "pronunciations" | "pronList">): Pron[] {
  const own = book.pronunciations ?? [];
  const owned = new Set(own.map((l) => l.from.toLowerCase()));
  return [...(book.pronList?.lines ?? []).filter((l) => !owned.has(l.from.toLowerCase())), ...own];
}

/** The lines a chapter is read with: the ones it was narrated under if frozen, else the book's current ones. */
export function linesFor(book: Pick<Book, "pronunciations" | "pronList" | "frozen">, index: number): Pron[] {
  return book.frozen?.[index] ?? effectiveLines(book);
}

/** The text actually sent to the narrator for a chapter. */
export function spokenText(book: Pick<Book, "pronunciations" | "pronList" | "frozen">, index: number, text: string): string {
  return applyPronunciations(text, linesFor(book, index));
}
