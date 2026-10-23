import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-test-"));
process.env.CACHE_DIR = cacheDir;

let server: Server;
let calls = 0;
let delayMs = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    calls++;
    req.resume();
    req.on("end", () => setTimeout(() => res.end(Buffer.alloc(200_000, 1)), delayMs));
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
  const { putObject } = await import("@/lib/storage/storage");
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
    const { startJob, runJob, getJob } = await import("@/lib/narration/narration");
    const { getObject } = await import("@/lib/storage/storage");
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
    const { startJob, runJob } = await import("@/lib/narration/narration");
    const before = calls;
    await startJob(ID, 3);
    const result = await runJob(ID, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect(calls).toBe(before);
  });

  it("narrates only the chapters in the chosen range", async () => {
    const { startJob, runJob, getJob, clampRange } = await import("@/lib/narration/narration");
    const { putObject, getObject, deleteObject } = await import("@/lib/storage/storage");
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
    const { startJob, cancelJob, runJob, getJob } = await import("@/lib/narration/narration");
    await startJob(ID, 3);
    await cancelJob(ID);
    const result = await runJob(ID, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect((await getJob(ID))?.status).toBe("cancelled");
  });

  it("pauses without being overwritten, then continues from the same place", async () => {
    const { startJob, pauseJob, resumeJob, runJob, getJob, listQueue } = await import("@/lib/narration/narration");
    const { deleteObject, putObject } = await import("@/lib/storage/storage");
    const id = "0011223344556677";
    const chapters = [0, 1, 2].map((i) => ({ index: i, title: `P${i}`, text: `P${i}. ${`Pause words ${i} `.repeat(30)}` }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "Pz", chapters }), "application/json");
    await putObject(
      `library/${id}.json`,
      JSON.stringify({ id, title: "Pz", chapterCount: 3, addedAt: 1, chars: chapters.map((c) => c.text.length) }),
      "application/json",
    );

    await startJob(id, 3);
    expect((await listQueue()).map((q) => q.id)).toContain(id);
    await pauseJob(id);
    const before = calls;
    const held = await runJob(id, { budgetMs: 60_000, reserveMs: 0 });
    expect(held.finished).toBe(true);
    expect(calls).toBe(before); // nothing spent while paused
    const j = await getJob(id);
    expect(j?.status).toBe("paused");
    expect(j?.leaseUntil).toBe(0);
    const q = (await listQueue()).find((x) => x.id === id);
    expect(q?.job.status).toBe("paused");
    expect(q?.remainingChars).toBeGreaterThan(0);

    await resumeJob(id);
    const done = await runJob(id, { budgetMs: 60_000, reserveMs: 0 });
    expect(done.finished).toBe(true);
    expect(calls).toBe(before + 3);
    expect((await getJob(id))?.status).toBe("done");
    expect((await listQueue()).map((x) => x.id)).not.toContain(id);
    await deleteObject(`jobs/${id}.json`);
  });

  it("a pause that arrives mid-run holds the status and leaves the chapter for later", async () => {
    const { startJob, pauseJob, runJob, getJob } = await import("@/lib/narration/narration");
    const { deleteObject, putObject } = await import("@/lib/storage/storage");
    const id = "8899aabbccddeeff";
    const text = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} of a long chapter. `.repeat(40)).join("\n\n");
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "L", chapters: [{ index: 0, title: "L", text }] }), "application/json");
    await startJob(id, 1);
    const callsBefore = calls;
    // Pause as soon as the first provider call is seen.
    delayMs = 150;
    const t = setTimeout(() => void pauseJob(id), 200);
    const result = await runJob(id, { budgetMs: 60_000, reserveMs: 0, stopCheckMs: 0 });
    clearTimeout(t);
    delayMs = 0;
    expect(calls).toBeLessThan(callsBefore + 12);
    expect(result.finished).toBe(true);
    expect((await getJob(id))?.status).toBe("paused");
    await deleteObject(`jobs/${id}.json`);
  });

  it("narrates exactly the listed chapters and skips the gaps", async () => {
    const { startJob, runJob, getJob, listQueue } = await import("@/lib/narration/narration");
    const { putObject, getObject, deleteObject } = await import("@/lib/storage/storage");
    const id = "1212343456567878";
    const chapters = [0, 1, 2, 3, 4].map((i) => ({ index: i, title: `L${i}`, text: `L${i}. ${`List test words ${i} `.repeat(30)}` }));
    await putObject(`books/${id}.json`, JSON.stringify({ id, title: "Li", chapters }), "application/json");
    await putObject(
      `library/${id}.json`,
      JSON.stringify({ id, title: "Li", chapterCount: 5, addedAt: 1, chars: chapters.map((c) => c.text.length) }),
      "application/json",
    );
    const job = await startJob(id, 5, undefined, [4, 1, 1, 99, -2]);
    expect(job.chapters).toEqual([1, 4]);
    expect((await listQueue()).find((q) => q.id === id)?.remainingChars).toBe(chapters[1].text.length + chapters[4].text.length);

    const before = calls;
    const result = await runJob(id, { budgetMs: 60_000, reserveMs: 0 });
    expect(result.finished).toBe(true);
    expect(calls).toBe(before + 2); // chapters 1 and 4 only, not 2 and 3
    expect((await getJob(id))?.status).toBe("done");
    const entry = JSON.parse((await getObject(`library/${id}.json`))!.toString("utf8"));
    expect(entry.narrated).toEqual([1, 4]);
    await deleteObject(`jobs/${id}.json`);
  });
});

describe("pressing play through the job queue", () => {
  it("won't replace a job that is already running for the book", async () => {
    const { POST } = await import("@/app/api/books/[id]/narrate/route");
    const { startJob, getJob } = await import("@/lib/narration/narration");
    const { deleteObject } = await import("@/lib/storage/storage");
    await seedBook();
    await deleteObject(`jobs/${ID}.json`);
    const post = (body: unknown) =>
      POST(new Request(`http://x/api/books/${ID}/narrate`, { method: "POST", body: JSON.stringify(body) }), {
        params: Promise.resolve({ id: ID }),
      });

    await startJob(ID, 3, { from: 0, to: 2 }); // a "Read it all" is running
    const busy = await post({ chapters: [2], onlyIfIdle: true });
    expect(busy.status).toBe(409);
    expect((await getJob(ID))?.chapters).toBeUndefined(); // untouched

    await deleteObject(`jobs/${ID}.json`);
    await post({ chapters: [2], onlyIfIdle: true }); // idle: starts a one-chapter job (the worker kick fails here)
    expect((await getJob(ID))?.chapters).toEqual([2]);
    await deleteObject(`jobs/${ID}.json`);
  });
});
