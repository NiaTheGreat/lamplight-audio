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
    const { assertBudget, recordUsage, getUsage, BudgetError } = await import("@/lib/usage");
    await assertBudget(60);
    await recordUsage(60);
    expect((await getUsage()).chars).toBe(60);
    await expect(assertBudget(60)).rejects.toBeInstanceOf(BudgetError);
    await expect(assertBudget(40)).resolves.toBeUndefined();
    delete process.env.MONTHLY_CHAR_LIMIT;
  });
});

describe("usage counter", () => {
  it("counts parallel updates without losing any", async () => {
    const { recordUsage, getUsage } = await import("@/lib/usage");
    const before = (await getUsage()).chars;
    await Promise.all(Array.from({ length: 10 }, () => recordUsage(7)));
    expect((await getUsage()).chars).toBe(before + 70);
  });
});

describe("login throttle", () => {
  it("locks an address after five wrong tries and unlocks on success", async () => {
    const { isBlocked, recordFailure, clearFailures } = await import("@/lib/throttle");
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
    const { getPublicUrl } = await import("@/lib/storage");
    expect(await getPublicUrl("audio/x.mp3")).toBeNull();
  });
});
