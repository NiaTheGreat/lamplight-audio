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
