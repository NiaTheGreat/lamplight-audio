import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deleteObject, listKeys, putObject } from "@/lib/storage";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;

afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

describe("library storage", () => {
  it("lists and deletes keys under a prefix", async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await putObject("library/aaaaaaaaaaaaaaaa.json", "{}", "application/json");
    await putObject("library/bbbbbbbbbbbbbbbb.json", "{}", "application/json");
    expect((await listKeys("library/")).sort()).toEqual([
      "library/aaaaaaaaaaaaaaaa.json",
      "library/bbbbbbbbbbbbbbbb.json",
    ]);
    await deleteObject("library/aaaaaaaaaaaaaaaa.json");
    expect(await listKeys("library/")).toEqual(["library/bbbbbbbbbbbbbbbb.json"]);
  });
});

describe("settings and progress", () => {
  it("clamps settings and remembers the last position", async () => {
    const { sanitizeSettings } = await import("@/lib/settings");
    expect(sanitizeSettings({ voice: "nope", speed: 9, sleep: 7, dim: 500 })).toEqual({
      voice: "ballad",
      speed: 2,
      sleep: 0,
      dim: 100,
    });
    const { savePosition, getProgress } = await import("@/lib/progress");
    await savePosition("abcdef0123456789", 2, 91.7);
    const p = await getProgress();
    expect(p.last).toMatchObject({ id: "abcdef0123456789", chapter: 2, time: 91 });
    expect(p.books["abcdef0123456789"].chapter).toBe(2);
  });
});
