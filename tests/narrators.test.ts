import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;

type Seen = { url: string; auth: string | undefined; body: Record<string, unknown> };
let server: Server;
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      });
      res.setHeader("Content-Type", "audio/mpeg");
      res.end(Buffer.alloc(300_000, 1));
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.DEEPINFRA_API_KEY = "deepinfra-test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";
});

afterAll(() => {
  server.close();
  rmSync(cacheDir, { recursive: true, force: true });
  for (const k of ["DEEPINFRA_BASE_URL", "OPENAI_BASE_URL", "DEEPINFRA_API_KEY", "OPENAI_API_KEY", "MONTHLY_BUDGET_USD"]) {
    delete process.env[k];
  }
});

describe("narrator ids", () => {
  it("treats a plain voice name as the original OpenAI narrator and knows Kokoro ids", async () => {
    const { parseNarrator, sanitizeNarrator, narratorLabel, providerOf } = await import("@/lib/narrators-shared");
    expect(parseNarrator("ballad")).toEqual({ provider: "openai", voice: "ballad" });
    expect(parseNarrator("deepinfra:kokoro:af_bella")).toEqual({ provider: "deepinfra", model: "kokoro", voice: "af_bella" });
    expect(parseNarrator("deepinfra:kokoro:")).toBeNull();
    expect(parseNarrator("somebody:else:voice")).toBeNull();
    expect(sanitizeNarrator("ballad")).toBe("ballad");
    expect(sanitizeNarrator("deepinfra:kokoro:af_bella")).toBe("deepinfra:kokoro:af_bella");
    expect(sanitizeNarrator("deepinfra:kokoro:not_a_voice")).toBeUndefined();
    expect(sanitizeNarrator("../../etc")).toBeUndefined();
    expect(providerOf("ballad")).toBe("openai");
    expect(providerOf("deepinfra:kokoro:af_bella")).toBe("deepinfra");
    expect(narratorLabel("ballad")).toBe("Ballad");
    expect(narratorLabel("deepinfra:kokoro:af_bella")).toBe("Bella (Kokoro)");
  });

  it("prices each narrator per million characters", async () => {
    const { costUsd } = await import("@/lib/narrators-shared");
    expect(costUsd(1_000_000, "ballad")).toBeCloseTo(16);
    expect(costUsd(1_000_000, "deepinfra:kokoro:af_bella")).toBeCloseTo(0.99);
    expect(costUsd(1_000_000, undefined)).toBeCloseTo(16); // no narrator recorded = the original OpenAI default
  });
});

describe("cache keys", () => {
  it("never share audio between narrators, and keep the Kokoro layout stable", async () => {
    const { audioKey } = await import("@/lib/tts");
    const text = "Hello world.";
    const keys = new Set([
      audioKey(text, "ballad"),
      audioKey(text, "nova"),
      audioKey(text, "deepinfra:kokoro:af_bella"),
      audioKey(text, "deepinfra:kokoro:af_heart"),
    ]);
    expect(keys.size).toBe(4);
    expect(audioKey(text, "deepinfra:kokoro:af_bella")).toMatch(/^audio\/[0-9a-f]{64}\.mp3$/);
    // Golden value for the new layout (computed independently of lib/tts.ts), so it can't drift later either.
    expect(audioKey(text, "deepinfra:kokoro:af_bella")).toBe("audio/9e046cdbfaf1ddcef30649617477a7c9d21ffc9ec9646771e95452c0a2463ed4.mp3");
  });
});

describe("Kokoro on DeepInfra", () => {
  it("sends an OpenAI-style speech request asking for MP3, with no OpenAI-only extras", async () => {
    const { synthChunk } = await import("@/lib/tts");
    seen.length = 0;
    const audio = await synthChunk("The quick brown fox jumps over the lazy dog.", "deepinfra:kokoro:af_bella");
    expect(audio.length).toBe(300_000);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/audio/speech");
    expect(seen[0].auth).toBe("Bearer deepinfra-test-key");
    expect(seen[0].body).toEqual({
      model: "hexgrad/Kokoro-82M",
      voice: "af_bella",
      input: "The quick brown fox jumps over the lazy dog.", // no trailing pad
      response_format: "mp3",
    });
  });

  it("leaves the OpenAI request exactly as it was (model, pad and instructions)", async () => {
    const { synthChunk } = await import("@/lib/tts");
    seen.length = 0;
    await synthChunk("Hello there, friend.", "ballad");
    expect(seen[0].auth).toBe("Bearer openai-test-key");
    expect(seen[0].body).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "ballad",
      input: "Hello there, friend.\n\n…",
      response_format: "mp3",
    });
    expect(typeof seen[0].body.instructions).toBe("string");
  });

  it("names the missing key when a provider isn't set up", async () => {
    const { synthChunk } = await import("@/lib/tts");
    const saved = process.env.DEEPINFRA_API_KEY;
    delete process.env.DEEPINFRA_API_KEY;
    try {
      await expect(synthChunk("Some text to read.", "deepinfra:kokoro:af_bella")).rejects.toThrow(
        "DEEPINFRA_API_KEY is not set.",
      );
    } finally {
      process.env.DEEPINFRA_API_KEY = saved;
    }
  });

  it("records spending at Kokoro's price, not OpenAI's", async () => {
    const { synthChunk } = await import("@/lib/tts");
    const { getUsage } = await import("@/lib/usage");
    const before = await getUsage();
    const text = "k".repeat(1000);
    await synthChunk(text, "deepinfra:kokoro:af_bella");
    const afterKokoro = await getUsage();
    expect(afterKokoro.usd - before.usd).toBeCloseTo((1000 * 0.99) / 1_000_000, 6);
    await synthChunk(text, "ballad");
    const afterOpenAi = await getUsage();
    expect(afterOpenAi.usd - afterKokoro.usd).toBeCloseTo((1000 * 16) / 1_000_000, 6);
    expect(afterOpenAi.chars - before.chars).toBe(2000);
  });
});

describe("dollar budget", () => {
  it("allows cheap narration and blocks costly narration under the same limit", async () => {
    const { assertBudget, getUsage, BudgetError } = await import("@/lib/usage");
    const used = (await getUsage()).usd;
    process.env.MONTHLY_BUDGET_USD = String(used + 0.001); // $0.001 of headroom
    await expect(assertBudget(500, "deepinfra:kokoro:af_bella")).resolves.toBeUndefined(); // ~$0.0005
    await expect(assertBudget(500, "ballad")).rejects.toBeInstanceOf(BudgetError); // ~$0.008
    await expect(assertBudget(500, "ballad")).rejects.toThrow(/Monthly narration budget reached/);
    delete process.env.MONTHLY_BUDGET_USD;
  });

  it("defaults to $30 and counts old character-only months as OpenAI", async () => {
    const { getUsage, flushUsage } = await import("@/lib/usage");
    const { putObject } = await import("@/lib/storage");
    expect((await getUsage()).limitUsd).toBe(30);
    await flushUsage(); // settle anything counted by the tests above before replacing the stored month
    await putObject(`usage/${new Date().toISOString().slice(0, 7)}.json`, JSON.stringify({ chars: 500_000 }), "application/json");
    expect((await getUsage()).usd).toBeCloseTo(8, 5); // 500k characters at $16 per million
  });
});

describe("changing a narrator", () => {
  const ID = "0123456789abcdef";
  async function seed(narrated: number[]) {
    const { putObject } = await import("@/lib/storage");
    await putObject(`books/${ID}.json`, JSON.stringify({ id: ID, title: "T", voice: "ballad", chapters: [] }), "application/json");
    await putObject(
      `library/${ID}.json`,
      JSON.stringify({ id: ID, title: "T", chapterCount: 3, addedAt: 1, voice: "ballad", narrated }),
      "application/json",
    );
  }

  it("works before anything is narrated and updates the book and its shelf entry", async () => {
    const { changeNarrator } = await import("@/lib/narrator");
    const { getObject } = await import("@/lib/storage");
    await seed([]);
    expect(await changeNarrator(ID, "deepinfra:kokoro:af_bella")).toBe("deepinfra:kokoro:af_bella");
    expect(JSON.parse((await getObject(`books/${ID}.json`))!.toString()).voice).toBe("deepinfra:kokoro:af_bella");
    expect(JSON.parse((await getObject(`library/${ID}.json`))!.toString()).voice).toBe("deepinfra:kokoro:af_bella");
  });

  it("refuses once any chapter is narrated, or for an unknown narrator", async () => {
    const { changeNarrator, NarratorChangeError } = await import("@/lib/narrator");
    await seed([1]);
    await expect(changeNarrator(ID, "deepinfra:kokoro:af_bella")).rejects.toMatchObject({ status: 409 });
    await seed([]);
    await expect(changeNarrator(ID, "nonsense")).rejects.toBeInstanceOf(NarratorChangeError);
  });
});
