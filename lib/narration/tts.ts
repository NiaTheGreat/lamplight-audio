import { createHash } from "node:crypto";
import { joinMp3 } from "./mp3";
import { PROVIDER_INFO, providerOf } from "../narrators-shared";
import { resolveNarrator } from "../providers";
import { getObject, hasObject, putObject } from "../storage/storage";
import { assertBudget, flushUsage, recordUsage } from "../storage/usage";
import { splitForTts } from "./text";

const defaultVoice = () => process.env.OPENAI_TTS_VOICE || "ballad";

/** How long one speech request may take before it is abandoned and retried. */
const REQUEST_TIMEOUT_MS = 120_000;

export { defaultVoice, joinMp3 };

/**
 * Cache key: same text + same narrator settings => same audio, generated once.
 *
 * A plain voice name is the original OpenAI narrator and hashes exactly as it
 * always has (audio already paid for lives under these keys; tests/cachekeys pins
 * them). Every other narrator gets its own versioned layout, so switching
 * narrators never reuses, overwrites or orphans another narrator's audio.
 */
export function audioKey(text: string, narrator: string = defaultVoice()): string {
  const { provider, voice } = resolveNarrator(narrator);
  const layout = provider.cacheLayout(text, narrator, voice);
  return `audio/${createHash("sha256").update(layout.join("\u0000")).digest("hex")}.mp3`;
}

const looksComplete = (audio: Buffer, text: string, narrator: string) =>
  audio.length >= text.length * PROVIDER_INFO[providerOf(narrator)].minBytesPerChar;

/** The request for one chunk. Everything else (retries, checks, usage) is shared. */
function buildRequest(input: string, narrator: string) {
  const { provider, voice } = resolveNarrator(narrator);
  const keyName = PROVIDER_INFO[provider.id].keyEnv;
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`${keyName} is not set.`);
  return { provider: provider.id, ...provider.request(input, voice, apiKey) };
}

export async function synthChunk(input: string, narrator: string = defaultVoice()): Promise<Buffer> {
  const req = buildRequest(input, narrator);
  const name = PROVIDER_INFO[req.provider].name;
  await assertBudget(input.length, narrator);

  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(req.url, {
        method: "POST",
        headers: {
          ...req.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout or dropped connection: wait and try again.
      lastError = `${name} TTS request failed: ${err instanceof Error ? err.message : "network error"}`;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (res.ok) {
      const audio = Buffer.from(await res.arrayBuffer());
      if (looksComplete(audio, input, narrator)) {
        await recordUsage(input.length, narrator);
        return audio;
      }
      lastError = `${name} returned too little audio (${audio.length} bytes) for ${input.length} characters.`;
      continue;
    }

    const detail = (await res.text()).slice(0, 300);
    lastError = `${name} TTS error ${res.status}: ${detail}`;
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
let synthesizedChars = 0;
/** Characters sent to a provider by this process so far (for measuring narration speed). */
export const charsSynthesized = () => synthesizedChars;

export async function synthesizeChapter(
  text: string,
  deadlineMs = 200_000,
  voice: string = defaultVoice(),
  /** Asked before each new chunk; true leaves the rest un-narrated (the chunks done stay cached). */
  shouldStop?: () => Promise<boolean>,
): Promise<ChapterProgress> {
  const chunks = splitForTts(text);
  const keys = chunks.map((c) => audioKey(c, voice));
  const stop = Date.now() + deadlineMs;
  const parts = new Array<Buffer | null>(chunks.length).fill(null);

  try {
    await mapLimit(chunks, 3, async (chunk, i) => {
      const cached = await getObject(keys[i]);
      if (cached && looksComplete(cached, chunk, voice)) {
        parts[i] = cached;
        return;
      }
      if (Date.now() >= stop) return;
      if (shouldStop && (await shouldStop())) return;
      const audio = await synthChunk(chunk, voice);
      synthesizedChars += chunk.length;
      await putObject(keys[i], audio, "audio/mpeg");
      parts[i] = audio;
    });
  } finally {
    // One storage write per chapter for the spending counter, not one per chunk.
    await flushUsage();
  }

  const ready = parts.filter(Boolean).length;
  if (ready < chunks.length) return { done: false, ready, total: chunks.length };
  // MP3 frames can simply be concatenated.
  return { done: true, audio: joinMp3(parts as Buffer[], { repair: PROVIDER_INFO[providerOf(voice)].needsMp3Repair }) };
}

/** How many of a chapter's chunks are already cached (for the progress bar). */
export async function chapterProgress(
  text: string,
  voice: string = defaultVoice(),
): Promise<{ ready: number; total: number }> {
  const keys = splitForTts(text).map((c) => audioKey(c, voice));
  const found = await Promise.all(keys.map(hasObject));
  return { ready: found.filter(Boolean).length, total: keys.length };
}
