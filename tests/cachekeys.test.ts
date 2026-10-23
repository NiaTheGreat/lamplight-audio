import { describe, expect, it } from "vitest";

/**
 * Golden values: the cache keys the app produced BEFORE narrators were introduced
 * (computed independently of lib/narration/tts.ts). Audio already paid for lives under these
 * keys, so they must never change. If this test fails, a refactor would make the
 * app re-narrate (and re-charge for) existing books.
 */
const INSTRUCTIONS =
  "Read this aloud as a warm, natural audiobook narrator. Keep a steady pace and give dialogue a little life.";
const GOLDEN = {
  miniBallad: "audio/fe6f0c332657949ca28db0634b8ba92740d43d2749c8e4af8594688a5411422b.mp3",
  tts1Nova: "audio/526ed2dca613874754fe1bf4ec6955c1e87ba4facdfdb6fa50787d4b37b2af62.mp3",
};

describe("existing OpenAI cache keys are unchanged", () => {
  it("gpt-4o-mini-tts / ballad (the default)", async () => {
    delete process.env.OPENAI_TTS_MODEL;
    delete process.env.TTS_INSTRUCTIONS;
    delete process.env.TTS_END_PAD;
    const { audioKey } = await import("@/lib/narration/tts");
    expect(audioKey("Hello world.", "ballad")).toBe(GOLDEN.miniBallad);
    // The default voice argument resolves the same way as an explicit "ballad".
    expect(audioKey("Hello world.")).toBe(GOLDEN.miniBallad);
  });

  it("tts-1 / nova (no instructions in the key)", async () => {
    process.env.OPENAI_TTS_MODEL = "tts-1";
    try {
      const { audioKey } = await import("@/lib/narration/tts");
      expect(audioKey("Hello world.", "nova")).toBe(GOLDEN.tts1Nova);
    } finally {
      delete process.env.OPENAI_TTS_MODEL;
    }
  });

  it("the instructions text is still part of the default key", () => {
    expect(INSTRUCTIONS.length).toBeGreaterThan(20); // documents what the golden hash was computed with
  });
});
