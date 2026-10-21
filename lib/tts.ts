import { createHash } from "node:crypto";
import { getObject, hasObject, putObject } from "./storage";
import { splitForTts } from "./text";

const model = () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const voice = () => process.env.OPENAI_TTS_VOICE || "coral";
const supportsInstructions = () => model().startsWith("gpt-4o");
const instructions = () =>
  process.env.TTS_INSTRUCTIONS ||
  "Read this aloud as a warm, natural audiobook narrator. Keep a steady pace and give dialogue a little life.";

// gpt-4o-mini-tts sometimes clips the last words of a request. A trailing pad
// gives it something harmless to end on. Override with TTS_END_PAD (empty = off).
const endPad = () => process.env.TTS_END_PAD ?? "\n\n…";

/** Cache key: same text + same voice settings => same audio, generated once. */
export function audioKey(text: string): string {
  const hash = createHash("sha256")
    .update(
      [model(), voice(), supportsInstructions() ? instructions() : "", endPad(), text].join("\u0000"),
    )
    .digest("hex");
  return `audio/${hash}.mp3`;
}

async function synthChunk(input: string): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const body: Record<string, unknown> = {
    model: model(),
    voice: voice(),
    input: input + endPad(),
    response_format: "mp3",
  };
  if (supportsInstructions()) body.instructions = instructions();

  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const res = await fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());

    const detail = (await res.text()).slice(0, 300);
    lastError = `OpenAI TTS error ${res.status}: ${detail}`;
    // Only retry rate limits and server errors. An empty balance is a 429 too,
    // but waiting won't fix it.
    if (res.status !== 429 && res.status < 500) break;
    if (detail.includes("insufficient_quota")) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(lastError);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export type ChapterProgress =
  | { done: true; audio: Buffer }
  | { done: false; ready: number; total: number };

/**
 * Narrate a chapter chunk by chunk. Every finished chunk is cached on its own,
 * so a chapter too long for one request just picks up where it stopped on the
 * next call. No new chunk is started after `deadlineMs`; the caller reports
 * progress and the client asks again.
 */
export async function synthesizeChapter(
  text: string,
  deadlineMs = 200_000,
): Promise<ChapterProgress> {
  const chunks = splitForTts(text);
  const keys = chunks.map(audioKey);
  const stop = Date.now() + deadlineMs;
  const parts = new Array<Buffer | null>(chunks.length).fill(null);

  await mapLimit(chunks, 3, async (chunk, i) => {
    const cached = await getObject(keys[i]);
    if (cached) {
      parts[i] = cached;
      return;
    }
    if (Date.now() >= stop) return;
    const audio = await synthChunk(chunk);
    await putObject(keys[i], audio, "audio/mpeg");
    parts[i] = audio;
  });

  const ready = parts.filter(Boolean).length;
  if (ready < chunks.length) return { done: false, ready, total: chunks.length };
  // MP3 frames can simply be concatenated.
  return { done: true, audio: Buffer.concat(parts as Buffer[]) };
}

/** How many of a chapter's chunks are already cached (for the progress bar). */
export async function chapterProgress(text: string): Promise<{ ready: number; total: number }> {
  const keys = splitForTts(text).map(audioKey);
  const found = await Promise.all(keys.map(hasObject));
  return { ready: found.filter(Boolean).length, total: keys.length };
}
