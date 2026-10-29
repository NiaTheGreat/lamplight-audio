import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe("monthly spending cap", () => {
  it("allows narration under the limit and refuses once it would be passed", async () => {
    process.env.MONTHLY_CHAR_LIMIT = "100";
    const { assertBudget, recordUsage, getUsage, BudgetError } =
      await import("@/lib/storage/usage");
    await assertBudget(60);
    await recordUsage(60);
    expect((await getUsage()).chars).toBe(60);
    await expect(assertBudget(60)).rejects.toBeInstanceOf(BudgetError);
    await expect(assertBudget(40)).resolves.toBeUndefined();
    delete process.env.MONTHLY_CHAR_LIMIT;
  });
});

describe("monthly limit saved in the app", () => {
  it("overrides MONTHLY_BUDGET_USD, can be reset, and rejects bad values", async () => {
    const { getUsage, setMonthlyBudgetUsd, assertBudget, BudgetError } =
      await import("@/lib/storage/usage");
    delete process.env.MONTHLY_BUDGET_USD;
    expect((await getUsage()).limitUsd).toBe(30);
    process.env.MONTHLY_BUDGET_USD = "12";
    expect(await setMonthlyBudgetUsd(null)).toBe(12);
    await setMonthlyBudgetUsd(0.01);
    expect(await getUsage()).toMatchObject({
      limitUsd: 0.01,
      limitSaved: true,
      defaultLimitUsd: 12,
    });
    await expect(assertBudget(1_000_000, "ballad")).rejects.toBeInstanceOf(BudgetError);
    await setMonthlyBudgetUsd(500);
    expect((await getUsage()).limitUsd).toBe(500);
    await expect(setMonthlyBudgetUsd(0)).rejects.toThrow();
    await expect(setMonthlyBudgetUsd(Number.NaN)).rejects.toThrow();
    await setMonthlyBudgetUsd(null);
    expect(await getUsage()).toMatchObject({ limitUsd: 12, limitSaved: false });
    delete process.env.MONTHLY_BUDGET_USD;
  });
});

describe("usage counter", () => {
  it("counts parallel updates without losing any", async () => {
    const { recordUsage, getUsage } = await import("@/lib/storage/usage");
    const before = (await getUsage()).chars;
    await Promise.all(Array.from({ length: 10 }, () => recordUsage(7)));
    expect((await getUsage()).chars).toBe(before + 70);
  });
});

describe("batched usage counter", () => {
  const monthFile = () => `usage/${new Date().toISOString().slice(0, 7)}.json`;
  const storedChars = async () => {
    const { getObject } = await import("@/lib/storage/storage");
    const raw = await getObject(monthFile());
    return raw
      ? (JSON.parse(raw.toString()) as { chars: number; usd: number })
      : { chars: 0, usd: 0 };
  };

  it("keeps counts in memory until flushed, but getUsage and the budget already include them", async () => {
    const { recordUsage, flushUsage, getUsage, assertBudget } = await import("@/lib/storage/usage");
    await flushUsage();
    const before = await storedChars();
    await recordUsage(1000, "ballad");
    await recordUsage(1000, "ballad");
    expect((await storedChars()).chars).toBe(before.chars); // nothing written yet
    expect((await getUsage()).chars).toBe(before.chars + 2000); // but it is counted
    process.env.MONTHLY_BUDGET_USD = String((await getUsage()).usd + 0.001);
    await expect(assertBudget(500, "ballad")).rejects.toThrow(/budget reached/); // pending counts toward the cap
    delete process.env.MONTHLY_BUDGET_USD;
    await flushUsage();
    expect((await storedChars()).chars).toBe(before.chars + 2000);
  });

  it("adds to the stored total instead of overwriting it (another server instance may have written)", async () => {
    const { recordUsage, flushUsage } = await import("@/lib/storage/usage");
    const { putObject } = await import("@/lib/storage/storage");
    await flushUsage();
    await recordUsage(500, "ballad");
    // Another instance saves a bigger total before this one flushes.
    await putObject(monthFile(), JSON.stringify({ chars: 1_000_000, usd: 16 }), "application/json");
    await flushUsage();
    const after = await storedChars();
    expect(after.chars).toBe(1_000_500);
    expect(after.usd).toBeCloseTo(16.008, 5);
  });

  it("a chapter writes the counter once, not once per chunk", async () => {
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end(Buffer.alloc(200_000, 1)));
    });
    await new Promise<void>((r) => server.listen(0, r));
    const { port } = server.address() as { port: number };
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.OPENAI_API_KEY = "test";
    try {
      const { flushUsage, getUsage } = await import("@/lib/storage/usage");
      const { synthesizeChapter } = await import("@/lib/narration/tts");
      const storage = await import("@/lib/storage/storage");
      await flushUsage();
      const before = await storedChars();
      // Unique words, so every chunk is different (identical chunks would share one cached file).
      const text = Array.from({ length: 1500 }, (_, k) => `word${k}`).join(" ");
      const { splitForTts } = await import("@/lib/narration/text");
      const chunks = splitForTts(text);
      expect(chunks.length).toBeGreaterThan(3);
      const result = await synthesizeChapter(text, 60_000, "ballad");
      expect(result.done).toBe(true);
      const after = await storedChars();
      // Every chunk is counted and already stored once the chapter is done...
      expect(after.chars - before.chars).toBe(chunks.reduce((n, c) => n + c.length, 0));
      // ...so nothing is left waiting in memory.
      expect((await getUsage()).chars).toBe(after.chars);
      void storage;
    } finally {
      server.close();
      delete process.env.OPENAI_BASE_URL;
      delete process.env.OPENAI_API_KEY;
    }
  });
});

describe("login throttle", () => {
  it("locks an address after five wrong tries and unlocks on success", async () => {
    const { isBlocked, recordFailure, clearFailures } = await import("@/lib/storage/throttle");
    for (let i = 0; i < 4; i++) await recordFailure("203.0.113.9");
    expect(await isBlocked("203.0.113.9")).toBe(false);
    await recordFailure("203.0.113.9");
    expect(await isBlocked("203.0.113.9")).toBe(true);
    expect(await isBlocked("198.51.100.1")).toBe(false);
    await clearFailures("203.0.113.9");
    expect(await isBlocked("203.0.113.9")).toBe(false);
  });
});

describe("public audio url", () => {
  it("is null when objects aren't served from Blob (local development)", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { getPublicUrl } = await import("@/lib/storage/storage");
    expect(await getPublicUrl("audio/x.mp3")).toBeNull();
  });
});
