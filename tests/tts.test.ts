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
    const { synthesizeChapter } = await import("@/lib/tts");
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
    const { synthesizeChapter, audioKey } = await import("@/lib/tts");
    const { putObject } = await import("@/lib/storage");
    const { splitForTts } = await import("@/lib/text");
    const t = `${"damaged ".repeat(150)}.`;
    const [chunk] = splitForTts(t);
    await putObject(audioKey(chunk), Buffer.from("MP3"), "audio/mpeg");
    const before = calls;
    const result = await synthesizeChapter(t);
    expect(result.done).toBe(true);
    expect(calls).toBe(before + 1);
  });

  it("reports how many chunks are cached", async () => {
    const { chapterProgress } = await import("@/lib/tts");
    const other = Array.from({ length: 3 }, (_, i) => `${"other ".repeat(700)}${i}`).join("\n\n");
    const before = await chapterProgress(other);
    expect(before.ready).toBe(0);
    expect(before.total).toBeGreaterThan(1);
    const { synthesizeChapter } = await import("@/lib/tts");
    await synthesizeChapter(other);
    expect(await chapterProgress(other)).toEqual({ ready: before.total, total: before.total });
  });
});
