import { splitForTts } from "../narration/text";
import type { ChunkTiming } from "./speech";

/** Extra "length" a pause adds, in characters, so sentence ends and paragraph breaks take longer. */
function prefixWeights(text: string): number[] {
  const w = new Array<number>(text.length + 1);
  w[0] = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    let x = 1;
    if (".!?…".includes(c)) x += 6;
    else if (",;:—".includes(c)) x += 2;
    else if (c === "\n") x += 5;
    w[i + 1] = w[i] + x;
  }
  return w;
}

function paragraphStarts(text: string): number[] {
  const starts = [0];
  const re = /\n{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index + m[0].length);
  return starts;
}

/** Map an offset in the chapter text to the matching offset in the spoken text (pronunciations change lengths). */
function toSpoken(
  original: string,
  spoken: string,
  o: number,
  oStarts: number[],
  sStarts: number[],
) {
  if (original === spoken) return o;
  if (oStarts.length !== sStarts.length)
    return Math.round((o / Math.max(1, original.length)) * spoken.length);
  let j = oStarts.length - 1;
  while (j > 0 && oStarts[j] > o) j--;
  const oEnd = j + 1 < oStarts.length ? oStarts[j + 1] : original.length + 2;
  const sEnd = j + 1 < sStarts.length ? sStarts[j + 1] : spoken.length + 2;
  const frac = (o - oStarts[j]) / Math.max(1, oEnd - 2 - oStarts[j]);
  return Math.round(sStarts[j] + frac * Math.max(0, sEnd - 2 - sStarts[j]));
}

/** How far from its guessed time a sentence start may be pulled to a real pause (seconds). */
const REACH = 4;
/** What leaving a sentence start at its guess costs, against pulling it to a pause (seconds). */
const LEAVE = 1.5;
/** Speech picks up again just before the pause ends. */
const LEAD = 0.05;

/**
 * Pull guessed sentence starts onto the pauses actually heard in the audio. Starts and pauses are
 * both in order, so this is a matching problem: each start takes at most one pause, each pause at
 * most one start, nothing crosses. Longer pauses are likelier sentence ends than commas, so they
 * are favoured. A start with no pause nearby keeps its guess, shifted by how far its neighbours moved.
 */
function snap(guess: number[], pauses: [number, number][], on: number, off: number): number[] {
  const n = guess.length;
  const m = pauses.length;
  if (n === 0 || m === 0) return guess;
  const cost = (i: number, j: number) => {
    const [a, b] = pauses[j];
    const dist = Math.abs(guess[i] - (a + b) / 2);
    if (dist > REACH) return Infinity;
    return dist - Math.min(b - a, 0.6) / 0.6;
  };
  // best[i][j]: cheapest way to settle the first i starts using only the first j pauses.
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    best[i][0] = i * LEAVE;
    for (let j = 1; j <= m; j++) {
      const c = cost(i - 1, j - 1);
      best[i][j] = Math.min(
        best[i][j - 1], // pause j is not a sentence end
        best[i - 1][j] + LEAVE, // start i keeps its guess
        c === Infinity ? Infinity : best[i - 1][j - 1] + c,
      );
    }
  }
  const moved = new Array<number | null>(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const c = cost(i - 1, j - 1);
    if (c !== Infinity && best[i][j] === best[i - 1][j - 1] + c) {
      const [a, b] = pauses[j - 1];
      moved[i - 1] = Math.max(a, b - LEAD);
      i--;
      j--;
    } else if (best[i][j] === best[i][j - 1]) j--;
    else i--;
  }
  // Shift the starts that found no pause by the movement of the ones either side.
  const anchors: { g: number; shift: number }[] = [{ g: on, shift: 0 }];
  moved.forEach((t, k) => t !== null && anchors.push({ g: guess[k], shift: t - guess[k] }));
  anchors.push({ g: off, shift: 0 });
  return guess.map((g, k) => {
    if (moved[k] !== null) return moved[k]!;
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (const a of anchors) {
      if (a.g <= g) lo = a;
      else {
        hi = a;
        break;
      }
    }
    const span = hi.g - lo.g;
    const f = span > 0 ? Math.min(1, Math.max(0, (g - lo.g) / span)) : 0;
    return g + lo.shift + f * (hi.shift - lo.shift);
  });
}

/**
 * When each sentence starts in the chapter's audio. The audio is the chunks `splitForTts` makes of
 * the spoken text, joined. Each chunk's length anchors the timeline exactly; inside a chunk the
 * speech runs from where it really starts to where it really ends, sentences are first guessed by
 * length (with a little extra for pauses), then pulled onto the pauses found in the audio.
 * Returns null if the chunk timings don't match the chunks.
 */
export function sentenceTimes(
  original: string,
  offsets: number[],
  spoken: string,
  timings: ChunkTiming[],
): number[] | null {
  const chunks = splitForTts(spoken);
  if (chunks.length === 0 || chunks.length !== timings.length) return null;

  const begins: number[] = [];
  const starts: number[] = [];
  let cursor = 0;
  let clock = 0;
  for (let i = 0; i < chunks.length; i++) {
    let at = spoken.indexOf(chunks[i], cursor);
    if (at < 0) at = cursor;
    begins.push(at);
    starts.push(clock);
    clock += timings[i].d;
    cursor = at + chunks[i].length;
  }
  const weights = chunks.map(prefixWeights);
  const oStarts = paragraphStarts(original);
  const sStarts = paragraphStarts(spoken);

  // Which chunk, and where in it, each sentence start falls.
  const where = offsets.map((o) => {
    const s = toSpoken(original, spoken, o, oStarts, sStarts);
    let k = begins.length - 1;
    while (k > 0 && begins[k] > s) k--;
    return { k, local: Math.min(chunks[k].length, Math.max(0, s - begins[k])) };
  });

  const times = new Array<number>(offsets.length).fill(0);
  for (let k = 0; k < chunks.length; k++) {
    const ids = where.flatMap((w, i) => (w.k === k ? [i] : []));
    if (ids.length === 0) continue;
    const { d, on, off, p } = timings[k];
    const w = weights[k];
    // A sentence that begins at the chunk's start begins when the chunk does.
    const guess = ids.map((i) => {
      const f = w[where[i].local] / Math.max(1, w[w.length - 1]);
      return on + f * (off - on);
    });
    const first = where[ids[0]].local === 0;
    const free = first ? ids.slice(1) : ids;
    const settled = snap(first ? guess.slice(1) : guess, p, on, off);
    if (first) times[ids[0]] = starts[k];
    free.forEach((i, n) => {
      times[i] = starts[k] + Math.min(d, Math.max(0, settled[n]));
    });
  }
  let last = 0;
  return times.map((t) => {
    last = Math.max(last, t);
    return Math.round(last * 100) / 100;
  });
}
