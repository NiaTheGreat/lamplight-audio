import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const cacheDir = mkdtempSync(path.join(tmpdir(), "abg-audio-"));
process.env.CACHE_DIR = cacheDir;
delete process.env.R2_ACCOUNT_ID;
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

const ID = "9999aaaabbbbcccc";
const call = async (qs: string) => {
  const { GET } = await import("@/app/api/audio/[id]/[chapter]/route");
  return GET(new Request(`http://x/api/audio/${ID}/0${qs}`), {
    params: Promise.resolve({ id: ID, chapter: "0" }),
  });
};

describe("playing a narrated chapter", () => {
  it("backfills the audio's address once, then plays without reading the book", async () => {
    const { putObject, deleteObject, getObject } = await import("@/lib/storage/storage");
    const { audioKey } = await import("@/lib/narration/tts");
    const { getKeys } = await import("@/lib/storage/keys");
    const text = "Chapter one. It was a dark night.";
    await putObject(
      `books/${ID}.json`,
      JSON.stringify({
        id: ID,
        title: "T",
        voice: "ballad",
        chapters: [{ index: 0, title: "One", text }],
      }),
      "application/json",
    );
    await putObject(
      `library/${ID}.json`,
      JSON.stringify({ id: ID, title: "T", chapterCount: 1, addedAt: 1 }),
      "application/json",
    );
    const key = audioKey(text, "ballad");
    await putObject(key, Buffer.alloc(5000, 1), "audio/mpeg");

    // First time: the book is read to work out the name, and the name is remembered.
    expect((await call("?prepare=1")).status).toBe(200);
    expect((await getKeys(ID))["0"]).toBe(key);

    // Now the book isn't needed at all.
    await deleteObject(`books/${ID}.json`);
    expect((await call("?prepare=1")).status).toBe(200);
    const res = await call("");
    expect([200, 206]).toContain(res.status);
    expect((await res.arrayBuffer()).byteLength).toBe(5000);
    expect(await getObject(`books/${ID}.json`)).toBeNull();
  });

  it("forgets a chapter's address when it is re-read, so the new narration is found", async () => {
    const { clearKeys, getKeys, setKey } = await import("@/lib/storage/keys");
    await setKey(ID, 3, "audio/x.mp3");
    expect((await getKeys(ID))["3"]).toBe("audio/x.mp3");
    await clearKeys(ID, [3]);
    expect((await getKeys(ID))["3"]).toBeUndefined();
  });
});
