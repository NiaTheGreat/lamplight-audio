import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSpeech, frameBits } from "@/lib/reader/speech";
import { sentenceTimes } from "@/lib/reader/timeline";

// MPEG1 layer III, 128 kbps, 44.1 kHz, stereo: 417-byte frames of 26.1 ms. The spectrum size of each
// granule sits in the side info; here every frame spreads `bits` evenly over its four granules.
function frame(bits: number): Buffer {
  const f = Buffer.alloc(417);
  f[0] = 0xff;
  f[1] = 0xfb;
  f[2] = 0x90;
  const each = Math.floor(bits / 4);
  for (let g = 0; g < 4; g++) {
    const start = 4 * 8 + 9 + 3 + 8 + g * 59; // header, main_data_begin, private bits, scfsi
    for (let i = 0; i < 12; i++) {
      const on = (each >> (11 - i)) & 1;
      const at = start + i;
      if (on) f[Math.floor(at / 8)] |= 1 << (7 - (at % 8));
    }
  }
  return f;
}
const run = (n: number, bits: number) => Array.from({ length: n }, () => frame(bits));

describe("frameBits", () => {
  it("reads the spectrum size of every frame", () => {
    const { dt, bits } = frameBits(Buffer.concat([frame(0), frame(800), frame(1600)]));
    expect(dt).toBeCloseTo(0.0261, 3);
    expect(bits).toEqual([0, 800, 1600]);
  });
});

describe("analyzeSpeech", () => {
  it("finds lead-in, trailing silence and a pause", () => {
    const audio = Buffer.concat([
      ...run(20, 0),
      ...run(60, 900),
      ...run(25, 0),
      ...run(60, 900),
      ...run(30, 0),
    ]);
    const t = analyzeSpeech(audio);
    const dt = 1152 / 44100;
    expect(t.on).toBeCloseTo(20 * dt, 1);
    expect(t.off).toBeCloseTo(165 * dt, 1);
    expect(t.p).toHaveLength(1);
    expect(t.p[0][0]).toBeCloseTo(80 * dt, 1);
    expect(t.p[0][1]).toBeCloseTo(105 * dt, 1);
  });

  it("finds no pauses in audio that never goes quiet", () => {
    const t = analyzeSpeech(Buffer.concat(run(100, 900)));
    expect(t.p).toEqual([]);
    expect(t.on).toBe(0);
  });
});

// Five sentences read by a speech synthesiser with 0.5 s of silence between them and 0.6 s at each end
// (made with ffmpeg's flite voice), so where each really starts is known.
describe("sentence times against real speech", () => {
  const text =
    "The rain fell softly on the old house. She listened for a long time. No. " +
    "Then the door opened, and a stranger stepped inside, shaking the water from his coat. He said nothing at all.";
  const offsets = ["The rain", "She", "No.", "Then", "He said"].map((s) => text.indexOf(s));
  const truth = [0.6, 3.75, 6.44, 7.73, 13.5];
  const audio = readFileSync(path.join(__dirname, "fixtures/speech-sequence.mp3"));

  it("finds the pauses", () => {
    const t = analyzeSpeech(audio);
    expect(t.on).toBeCloseTo(0.6, 1);
    expect(t.p).toHaveLength(4);
  });

  it("puts sentence starts on the real boundaries, which length alone gets wrong", () => {
    const t = analyzeSpeech(audio);
    const guessed = sentenceTimes(text, offsets, text, [{ d: t.d, on: 0, off: t.d, p: [] }])!;
    const heard = sentenceTimes(text, offsets, text, [t])!;
    const worst = (xs: number[]) =>
      Math.max(...xs.slice(1).map((x, i) => Math.abs(x - truth[i + 1])));
    expect(worst(heard)).toBeLessThan(0.3);
    expect(worst(guessed)).toBeGreaterThan(0.8);
  });
});
