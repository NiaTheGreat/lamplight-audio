import { frameAt, isInfoFrame } from "../narration/mp3";

/**
 * Where speech is and where it pauses in a narrated chunk, read from the MP3 itself with no
 * decoding. Each Layer III granule records how many bits its spectrum took (`part2_3_length`): a
 * few for silence, hundreds for speech. So a run of cheap frames is a pause, and the cheap frames
 * at either end are lead-in and trailing silence. Times are seconds from the start of the chunk.
 */
export type ChunkTiming = {
  /** Length of the chunk's audio. */
  d: number;
  /** When speech starts and ends (after any leading and trailing silence). */
  on: number;
  off: number;
  /** Pauses inside the speech: [start, end] pairs. */
  p: [number, number][];
};

const SAMPLES_PER_FRAME: Record<number, number> = { 3: 1152, 2: 576, 0: 576 };
const RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Bits used by each audio frame's spectrum, and how long a frame lasts. */
export function frameBits(b: Buffer): { dt: number; bits: number[] } {
  const bits: number[] = [];
  let dt = 0;
  let at = 0;
  while (b.toString("latin1", at, at + 3) === "ID3" && at + 10 <= b.length) {
    at +=
      10 +
      (((b[at + 6] & 0x7f) << 21) |
        ((b[at + 7] & 0x7f) << 14) |
        ((b[at + 8] & 0x7f) << 7) |
        (b[at + 9] & 0x7f));
  }
  while (at + 4 <= b.length) {
    const f = frameAt(b, at);
    if (!f) break;
    if (!isInfoFrame(b, at, f)) {
      const version = (b[at + 1] >> 3) & 3;
      const mono = ((b[at + 3] >> 6) & 3) === 3;
      const channels = mono ? 1 : 2;
      const rate = RATES[version][(b[at + 2] >> 2) & 3];
      dt = SAMPLES_PER_FRAME[version] / rate;
      const side = at + 4 + ((b[at + 1] & 1) === 0 ? 2 : 0);
      // Walk the side info as a bit string to each granule/channel's part2_3_length (12 bits).
      const bit = (n: number) => (b[side + (n >> 3)] >> (7 - (n & 7))) & 1;
      const read = (n: number, w: number) => {
        let v = 0;
        for (let i = 0; i < w; i++) v = (v << 1) | bit(n + i);
        return v;
      };
      let sum = 0;
      if (version === 3) {
        let n = 9 + (mono ? 5 : 3) + 4 * channels;
        for (let g = 0; g < 2 * channels; g++, n += 59) sum += read(n, 12);
      } else {
        let n = 8 + (mono ? 1 : 2);
        for (let c = 0; c < channels; c++, n += 63) sum += read(n, 12);
      }
      bits.push(sum);
    }
    at += f.length;
  }
  return { dt, bits };
}

const MIN_PAUSE = 0.12;

/** Find the speech, its lead-in and trailing silence, and the pauses between, in one chunk's MP3. */
export function analyzeSpeech(audio: Buffer): ChunkTiming {
  const { dt, bits } = frameBits(audio);
  const d = bits.length * dt;
  const whole: ChunkTiming = { d, on: 0, off: d, p: [] };
  if (bits.length < 8) return whole;

  const sorted = [...bits].sort((a, b) => a - b);
  const level = sorted[Math.floor(sorted.length * 0.8)];
  const floor = sorted[Math.floor(sorted.length * 0.05)];
  if (level < 100) return whole; // nothing that sounds like speech
  if (floor > level * 0.35) return whole; // never quiet: no pauses to find
  // Quiet = close to the quietest frames, whether those are digital silence or a faint noise floor.
  const cut = floor + (level - floor) * 0.15;
  const quiet = (i: number) => bits[i] < cut;

  // Runs of quiet frames.
  const runs: [number, number][] = [];
  for (let i = 0; i < bits.length;) {
    if (!quiet(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < bits.length && quiet(j)) j++;
    runs.push([i, j]);
    i = j;
  }
  if (runs.length === 0) return whole;

  let on = 0;
  let off = d;
  let inner = runs;
  if (runs[0][0] === 0) {
    on = runs[0][1] * dt;
    inner = inner.slice(1);
  }
  const last = inner[inner.length - 1];
  if (last && last[1] === bits.length) {
    off = last[0] * dt;
    inner = inner.slice(0, -1);
  }
  const p = inner
    .filter(([a, b]) => (b - a) * dt >= MIN_PAUSE)
    .map(
      ([a, b]) =>
        [Math.round(a * dt * 100) / 100, Math.round(b * dt * 100) / 100] as [number, number],
    );
  return {
    d: Math.round(d * 100) / 100,
    on: Math.round(on * 100) / 100,
    off: Math.round(off * 100) / 100,
    p,
  };
}
