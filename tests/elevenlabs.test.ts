import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;

type Seen = {
  url: string;
  key: string | undefined;
  auth: string | undefined;
  body: Record<string, unknown>;
};
let server: Server;
const seen: Seen[] = [];
const RACHEL = "elevenlabs:flash:21m00Tcm4TlvDq8ikWAM";

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        url: req.url ?? "",
        key: req.headers["xi-api-key"] as string | undefined,
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      });
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(Buffer.alloc(300_000, 1));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  process.env.ELEVENLABS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ELEVENLABS_API_KEY = "eleven-test-key";
});

afterAll(() => {
  server.close();
  rmSync(cacheDir, { recursive: true, force: true });
  for (const k of ["ELEVENLABS_BASE_URL", "ELEVENLABS_API_KEY"]) delete process.env[k];
});

describe("ElevenLabs narrators", () => {
  it("parses, labels, prices and sanitizes ElevenLabs ids", async () => {
    const { parseNarrator, sanitizeNarrator, narratorLabel, providerOf, costUsd } =
      await import("@/lib/narrators-shared");
    expect(parseNarrator(RACHEL)).toEqual({
      provider: "elevenlabs",
      model: "flash",
      voice: "21m00Tcm4TlvDq8ikWAM",
    });
    expect(sanitizeNarrator(RACHEL)).toBe(RACHEL);
    expect(sanitizeNarrator("elevenlabs:flash:nope")).toBeUndefined();
    expect(providerOf(RACHEL)).toBe("elevenlabs");
    expect(narratorLabel(RACHEL)).toBe("Rachel (ElevenLabs)");
    expect(costUsd(1_000_000, RACHEL)).toBeCloseTo(60);
  });

  it("sends a text-to-speech request with the xi-api-key header and the Flash model", async () => {
    const { synthChunk } = await import("@/lib/narration/tts");
    seen.length = 0;
    const audio = await synthChunk("The quick brown fox jumps over the lazy dog.", RACHEL);
    expect(audio.length).toBe(300_000);
    expect(seen[0].url).toBe("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128");
    expect(seen[0].key).toBe("eleven-test-key");
    expect(seen[0].auth).toBeUndefined();
    expect(seen[0].body).toEqual({
      text: "The quick brown fox jumps over the lazy dog.",
      model_id: "eleven_flash_v2_5",
    });
  });

  it("offers Flash, v4 Turbo and v4 with their own prices, labels and model ids", async () => {
    const { parseNarrator, sanitizeNarrator, narratorLabel, costUsd, NARRATOR_GROUPS } =
      await import("@/lib/narrators-shared");
    const { synthChunk, audioKey } = await import("@/lib/narration/tts");
    const TURBO = "elevenlabs:v4turbo:21m00Tcm4TlvDq8ikWAM";
    const V4 = "elevenlabs:v4:21m00Tcm4TlvDq8ikWAM";
    expect(parseNarrator(TURBO)?.model).toBe("v4turbo");
    expect(sanitizeNarrator(V4)).toBe(V4);
    expect(sanitizeNarrator("elevenlabs:v9:21m00Tcm4TlvDq8ikWAM")).toBeUndefined();
    expect(narratorLabel(TURBO)).toBe("Rachel (ElevenLabs v4 Turbo)");
    expect(costUsd(1_000_000, TURBO)).toBeCloseTo(40);
    expect(costUsd(1_000_000, V4)).toBeCloseTo(80);
    expect(NARRATOR_GROUPS.filter((g) => g.provider === "elevenlabs").map((g) => g.label)).toEqual([
      "ElevenLabs Flash v2.5",
      "ElevenLabs v4 Turbo",
      "ElevenLabs v4",
    ]);
    // Each model gets its own cache key.
    const keys = new Set([RACHEL, TURBO, V4].map((n) => audioKey("Hello.", n)));
    expect(keys.size).toBe(3);

    seen.length = 0;
    await synthChunk("The quick brown fox jumps over the lazy dog.", TURBO);
    await synthChunk("The quick brown fox jumps over the lazy dog.", V4);
    expect(seen.map((r) => r.body.model_id)).toEqual(["eleven_v4_turbo", "eleven_v4"]);
  });

  it("lets ELEVENLABS_TTS_MODEL override Flash only", async () => {
    const { synthChunk } = await import("@/lib/narration/tts");
    process.env.ELEVENLABS_TTS_MODEL = "eleven_multilingual_v2";
    try {
      seen.length = 0;
      await synthChunk("An override line to read aloud, please.", RACHEL);
      await synthChunk(
        "An override line to read aloud, please.",
        "elevenlabs:v4:21m00Tcm4TlvDq8ikWAM",
      );
      expect(seen.map((r) => r.body.model_id)).toEqual(["eleven_multilingual_v2", "eleven_v4"]);
    } finally {
      delete process.env.ELEVENLABS_TTS_MODEL;
    }
  });

  it("gets its own cache keys and names a missing key", async () => {
    const { audioKey, synthChunk } = await import("@/lib/narration/tts");
    expect(audioKey("Hello.", RACHEL)).toMatch(/^audio\/[0-9a-f]{64}\.mp3$/);
    expect(audioKey("Hello.", RACHEL)).not.toBe(
      audioKey("Hello.", "elevenlabs:flash:XrExE9yKIg1WjnnlVkGX"),
    );
    expect(audioKey("Hello.", RACHEL)).not.toBe(audioKey("Hello.", "ballad"));
    delete process.env.ELEVENLABS_API_KEY;
    await expect(synthChunk("Some text to read.", RACHEL)).rejects.toThrow(
      "ELEVENLABS_API_KEY is not set.",
    );
    process.env.ELEVENLABS_API_KEY = "eleven-test-key";
  });
});
