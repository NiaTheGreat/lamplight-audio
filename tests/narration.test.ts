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

const ID = "abcdef0123456789";

async function seedBook() {
  const { putObject } = await import("@/lib/storage");
  const chapters = [0, 1, 2].map((i) => ({
    index: i,
    title: `Chapter ${i + 1}`,
    text: `Chapter ${i + 1}. ${`Story words number ${i} `.repeat(30)}`,
  }));
  await putObject(`books/${ID}.json`, JSON.stringify({ id: ID, title: "T", chapters }), "application/json");
  await putObject(
    `library/${ID}.json`,
    JSON.stringify({ id: ID, title: "T", chapterCount: 3, addedAt: 1 }),
    "application/json",
  );
}

describe("background narration job", () => {
  it("makes no progress without time, then finishes and records narrated chapters", async () => {
    const { startJob, runJob, getJob } = await import("@/lib/narration");
    const { getObject } = await import("@/lib/storage");
    await seedBook();
    await startJob(ID, 3);

    const none = await runJob(ID, { budgetMs: 0, reserveMs: 0 });
    expect(none.finished).toBe(false);
    expect((await getJob(ID))?.chapter).toBe(0);
    expect(calls).toBe(0);

    const done = await runJob(ID, { budgetMs: 60_000, reserveMs: 0 });
    expect(done.finished).toBe(true);
    expect((await getJob(ID))?.status).toBe("done");
    expect(calls).toBe(3);

    const entry = JSON.parse((await getObject(`library/${ID}.json`))!.toString("utf8"));
    expect(entry.narrated).toEqual([0, 1, 2]);
  });

  it("skips chapters that are already narrated when restarted", async () => {
    const { startJob, runJob } = await import("@/lib/narration");
    const before = calls;
    await startJob(ID, 3);
    const result = await runJob(ID, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect(calls).toBe(before);
  });

  it("narrates only the chapters in the chosen range", async () => {
    const { startJob, runJob, getJob, clampRange } = await import("@/lib/narration");
    const { putObject, getObject, deleteObject } = await import("@/lib/storage");
    expect(clampRange(10, 22, 3)).toEqual({ from: 3, to: 9 }); // from beyond the end is pulled in, then ordered
    expect(clampRange(10, undefined, undefined)).toEqual({ from: 0, to: 9 });
    expect(clampRange(10, -4, 2)).toEqual({ from: 0, to: 2 });

    // A fresh book whose chapters have never been narrated.
    const id = "fedcba9876543210";
    const chapters = [0, 1, 2, 3].map((i) => ({
      index: i,
      title: `Part ${i + 1}`,
      text: `Part ${i + 1}. ${`Range test words ${i} `.repeat(30)}`,
    }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "R", chapters }), "application/json");
    await putObject(`library/${id}.json`, JSON.stringify({ id, title: "R", chapterCount: 4, addedAt: 1 }), "application/json");

    const before = calls;
    await startJob(id, 4, { from: 1, to: 2 });
    const result = await runJob(id, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect((await getJob(id))?.chapter).toBe(3);
    expect(calls).toBe(before + 2); // chapters 2 and 3 of the book only
    const entry = JSON.parse((await getObject(`library/${id}.json`))!.toString("utf8"));
    expect(entry.narrated).toEqual([1, 2]);
    await deleteObject(`jobs/${id}.json`);
  });

  it("stops when cancelled", async () => {
    const { startJob, cancelJob, runJob, getJob } = await import("@/lib/narration");
    await startJob(ID, 3);
    await cancelJob(ID);
    const result = await runJob(ID, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect((await getJob(ID))?.status).toBe("cancelled");
  });
});
