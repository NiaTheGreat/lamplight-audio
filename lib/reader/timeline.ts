import { splitForTts } from "../narration/text";

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

/**
 * When each sentence starts in the chapter's audio. The audio is the chunks `splitForTts` makes of
 * the spoken text, joined, so each chunk's true duration anchors the timeline and sentences are
 * spread across a chunk by length (with a little extra for pauses). Exact at chunk boundaries,
 * an estimate between them. Returns null if the chunk durations don't match the chunks.
 */
export function sentenceTimes(
  original: string,
  offsets: number[],
  spoken: string,
  durations: number[],
): number[] | null {
  const chunks = splitForTts(spoken);
  if (chunks.length === 0 || chunks.length !== durations.length) return null;

  const begins: number[] = [];
  const starts: number[] = [];
  let cursor = 0;
  let clock = 0;
  for (let i = 0; i < chunks.length; i++) {
    let at = spoken.indexOf(chunks[i], cursor);
    if (at < 0) at = cursor;
    begins.push(at);
    starts.push(clock);
    clock += durations[i];
    cursor = at + chunks[i].length;
  }
  const weights = chunks.map(prefixWeights);
  const oStarts = paragraphStarts(original);
  const sStarts = paragraphStarts(spoken);

  let last = 0;
  return offsets.map((o) => {
    const s = toSpoken(original, spoken, o, oStarts, sStarts);
    let k = begins.length - 1;
    while (k > 0 && begins[k] > s) k--;
    const local = Math.min(chunks[k].length, Math.max(0, s - begins[k]));
    const w = weights[k];
    const t = starts[k] + (durations[k] * w[local]) / Math.max(1, w[w.length - 1]);
    last = Math.max(last, t);
    return Math.round(last * 100) / 100;
  });
}
