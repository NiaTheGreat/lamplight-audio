import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;

let server: Server;
let calls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    calls++;
    req.resume();
    req.on("end", () => res.end(Buffer.alloc(200_000, 1)));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.OPENAI_API_KEY = "test";
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
afterAll(() => {
  server.close();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("synthesizeChapter", () => {
  const text = Array.from({ length: 6 }, (_, i) => `${"word ".repeat(700)}${i}`).join("\n\n");

  it("returns progress when out of time, then resumes from cached chunks", async () => {
    const { synthesizeChapter } = await import("@/lib/narration/tts");
    const partial = await synthesizeChapter(text, -1);
    expect(partial).toMatchObject({ done: false, ready: 0 });
    expect(calls).toBe(0);

    const full = await synthesizeChapter(text);
    expect(full.done).toBe(true);
    const made = calls;
    expect(made).toBeGreaterThan(1);

    const again = await synthesizeChapter(text, -1);
    expect(again.done).toBe(true);
    expect(calls).toBe(made);
  });

  it("regenerates a cached chunk that is empty or cut off", async () => {
    const { synthesizeChapter, audioKey } = await import("@/lib/narration/tts");
    const { putObject } = await import("@/lib/storage/storage");
    const { splitForTts } = await import("@/lib/narration/text");
    const t = `${"damaged ".repeat(150)}.`;
    const [chunk] = splitForTts(t);
    await putObject(audioKey(chunk), Buffer.from("MP3"), "audio/mpeg");
    const before = calls;
    const result = await synthesizeChapter(t);
    expect(result.done).toBe(true);
    expect(calls).toBe(before + 1);
  });

  it("stops before calling OpenAI once the monthly cap is reached", async () => {
    process.env.MONTHLY_CHAR_LIMIT = "10";
    const { synthesizeChapter } = await import("@/lib/narration/tts");
    const before = calls;
    await expect(
      synthesizeChapter("A fresh chapter that was never narrated before, long enough."),
    ).rejects.toThrow(/Monthly narration limit/);
    expect(calls).toBe(before);
    delete process.env.MONTHLY_CHAR_LIMIT;
  });

  it("reports how many chunks are cached", async () => {
    const { chapterProgress } = await import("@/lib/narration/tts");
    const other = Array.from({ length: 3 }, (_, i) => `${"other ".repeat(700)}${i}`).join("\n\n");
    const before = await chapterProgress(other);
    expect(before.ready).toBe(0);
    expect(before.total).toBeGreaterThan(1);
    const { synthesizeChapter } = await import("@/lib/narration/tts");
    await synthesizeChapter(other);
    expect(await chapterProgress(other)).toEqual({ ready: before.total, total: before.total });
  });
});

describe("busy providers", () => {
  it("computes backoff with jitter and Retry-After", async () => {
    const { backoffMs, retryTiming } = await import("@/lib/narration/retry");
    expect(backoffMs(0, "7")).toBe(7000);
    expect(backoffMs(0, "9999")).toBe(retryTiming.retryAfterCapMs);
    expect(backoffMs(2, null, () => 1)).toBe(12_000);
    expect(backoffMs(9, null, () => 1)).toBe(retryTiming.capMs);
  });

  it("retries a busy answer, then throws ProviderBusyError once the tries run out", async () => {
    const { synthChunk } = await import("@/lib/narration/tts");
    const { ProviderBusyError, retryTiming } = await import("@/lib/narration/retry");
    const saved = { ...retryTiming };
    Object.assign(retryTiming, { baseMs: 1, capMs: 2, maxAttempts: 3 });
    let hits = 0;
    const busy = createServer((req, res) => {
      hits++;
      req.resume();
      req.on("end", () => {
        res.statusCode = 429;
        res.end('{"detail":"Model busy, retry later"}');
      });
    });
    await new Promise<void>((r) => busy.listen(0, r));
    const { port } = busy.address() as { port: number };
    process.env.DEEPINFRA_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.DEEPINFRA_API_KEY = "test";
    const waits: number[] = [];
    try {
      await expect(
        synthChunk("Hello there.", "deepinfra:kokoro:af_bella", (i) => waits.push(i.waitMs)),
      ).rejects.toBeInstanceOf(ProviderBusyError);
      expect(hits).toBe(3);
      expect(waits).toHaveLength(2);
    } finally {
      Object.assign(retryTiming, saved);
      busy.close();
    }
  });

  it("does not wait on an empty balance", async () => {
    const { isBusyResponse } = await import("@/lib/narration/retry");
    expect(isBusyResponse(429, '{"error":{"code":"insufficient_quota"}}')).toBe(false);
    expect(isBusyResponse(429, "Model busy")).toBe(true);
    expect(isBusyResponse(400, "bad")).toBe(false);
  });
});
