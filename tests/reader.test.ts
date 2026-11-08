import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { sentenceAt, sentenceRanges, splitSentences } from "@/lib/reader/sentences";
import { sentenceTimes } from "@/lib/reader/timeline";
import type { ChunkTiming } from "@/lib/reader/speech";

/** Timings with no pauses found: what is known when only the chunk lengths are. */
const plain = (d: number): ChunkTiming => ({ d, on: 0, off: d, p: [] });
import { splitForTts } from "@/lib/narration/text";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-reader-"));
process.env.CACHE_DIR = cacheDir;
delete process.env.R2_ACCOUNT_ID;
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe("sentences", () => {
  it("splits at sentence ends, keeping quotes and not breaking after Mr.", () => {
    const text = 'He said, "Go home." Mr. Smith left! Did he? Yes… maybe';
    const parts = sentenceRanges(text).map((r) => text.slice(r.a, r.b));
    expect(parts).toEqual(['He said, "Go home."', "Mr. Smith left!", "Did he?", "Yes…", "maybe"]);
  });

  it("numbers sentences by their offset in the chapter text, skipping scene breaks", () => {
    const paras = [
      { runs: [{ t: "One. Two." }] },
      { runs: [], kind: "break" as const },
      { runs: [{ t: "Three." }] },
    ];
    const s = splitSentences(paras);
    expect(s.map((x) => x.off)).toEqual([0, 5, 11]);
    expect("One. Two.\n\nThree.".slice(s[2].off)).toBe("Three.");
    expect(s[2].p).toBe(2);
  });

  it("finds the sentence for a time", () => {
    const times = [0, 4, 9];
    expect([0, 3.9, 4, 8.9, 9, 99].map((t) => sentenceAt(times, t))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

const sentence = "The rain fell softly on the old house and she listened for a long time. ";
const para = (n: number, word = "rain") => sentence.replace("rain", word).repeat(n).trim();
const three = () => [para(12, "rain"), para(12, "snow"), para(12, "hail")].join("\n\n");

describe("sentence times", () => {
  const text = three();
  const offsets = splitSentences(text.split("\n\n").map((t) => ({ runs: [{ t }] }))).map(
    (s) => s.off,
  );

  it("is exact at every chunk boundary and never goes backwards", () => {
    const chunks = splitForTts(text);
    expect(chunks.length).toBeGreaterThan(1);
    const durations = chunks.map((_, i) => 60 + i * 10);
    const timings = durations.map(plain);
    const times = sentenceTimes(text, offsets, text, timings)!;
    expect(times).toHaveLength(offsets.length);
    expect(times[0]).toBe(0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    // The first sentence of the second chunk starts exactly when the first chunk ends.
    const second = text.indexOf(chunks[1]);
    const at = offsets.findIndex((o) => o >= second);
    expect(times[at]).toBeCloseTo(durations[0], 1);
    expect(times[times.length - 1]).toBeLessThan(durations.reduce((a, b) => a + b, 0));
  });

  it("copes with pronunciations that lengthen words", () => {
    const spoken = text.replaceAll("rain", "reh-yn");
    const durations = splitForTts(spoken).map(() => plain(50));
    const times = sentenceTimes(text, offsets, spoken, durations)!;
    expect(times).toHaveLength(offsets.length);
    expect(times[times.length - 1]).toBeGreaterThan(90);
  });

  it("gives up (null) when the durations don't match the chunks", () => {
    expect(sentenceTimes(text, offsets, text, [plain(10)])).toBeNull();
  });
});

// MPEG1 layer III, 128 kbps, 44.1 kHz: 417-byte frames of 26.1 ms.
const frame = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413, 1)]);
const mp3 = (frames: number) => Buffer.concat(Array.from({ length: frames }, () => frame));

describe("reader route", () => {
  const ID = "7777aaaabbbbcccc";
  const get = async (chapter = 0) => {
    const { GET } = await import("@/app/api/reader/[id]/[chapter]/route");
    return GET(new Request(`http://x/api/reader/${ID}/${chapter}`), {
      params: Promise.resolve({ id: ID, chapter: String(chapter) }),
    });
  };

  it("shows plain text with no timing before narration", async () => {
    const { putObject } = await import("@/lib/storage/storage");
    const text = three();
    await putObject(
      `books/${ID}.json`,
      JSON.stringify({
        id: ID,
        title: "T",
        voice: "ballad",
        chapters: [{ index: 0, title: "One", text }],
      }),
      "application/json",
    );
    const body = await (await get()).json();
    expect(body.narrated).toBe(false);
    expect(body.times).toBeNull();
    expect(body.formatted).toBe(false);
    expect(body.paras).toHaveLength(3);
  });

  it("measures the narrated chunks once and returns sentence times", async () => {
    const { putObject, getObject } = await import("@/lib/storage/storage");
    const { audioKey } = await import("@/lib/narration/tts");
    const text = three();
    const chunks = splitForTts(text);
    for (const [i, c] of chunks.entries())
      await putObject(audioKey(c, "ballad"), mp3(100 + i * 50), "audio/mpeg");
    await putObject(audioKey(text, "ballad"), Buffer.alloc(5000, 1), "audio/mpeg");

    const body = await (await get()).json();
    expect(body.narrated).toBe(true);
    expect(body.times.length).toBeGreaterThan(10);
    expect(body.total).toBeGreaterThan(5);
    expect(body.times[0]).toBe(0);

    // Remembered: the chunk files are not needed a second time.
    for (const c of chunks)
      await (await import("@/lib/storage/storage")).deleteObject(audioKey(c, "ballad"));
    expect(await getObject(`timing/${ID}.json`)).not.toBeNull();
    const again = await (await get()).json();
    expect(again.times).toEqual(body.times);
  });

  it("answers 404 when the reader is turned off", async () => {
    process.env.READER_ENABLED = "false";
    try {
      expect((await get()).status).toBe(404);
      const { GET } = await import("@/app/api/reader/[id]/route");
      const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: ID }) });
      expect(await res.json()).toEqual({ enabled: false, hasEpub: false });
    } finally {
      delete process.env.READER_ENABLED;
    }
  });
});
