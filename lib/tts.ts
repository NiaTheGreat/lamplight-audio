import { createHash } from "node:crypto";
import { joinMp3 } from "./mp3";
import { parseNarrator, providerOf, type Provider, PROVIDER_KEY_ENV } from "./narrators-shared";
import { getObject, hasObject, putObject } from "./storage";
import { assertBudget, flushUsage, recordUsage } from "./usage";
import { splitForTts } from "./text";

const model = () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const defaultVoice = () => process.env.OPENAI_TTS_VOICE || "ballad";
const supportsInstructions = () => model().startsWith("gpt-4o");
const instructions = () =>
  process.env.TTS_INSTRUCTIONS ||
  "Read this aloud as a warm, natural audiobook narrator. Keep a steady pace and give dialogue a little life.";

// gpt-4o-mini-tts sometimes clips the last words of a request. A trailing pad
// gives it something harmless to end on. Override with TTS_END_PAD (empty = off).
const endPad = () => process.env.TTS_END_PAD ?? "\n\n…";

const KOKORO_MODEL = "hexgrad/Kokoro-82M";
const deepinfraBase = () => process.env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1/openai";

const elevenLabsModel = () => process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";
const elevenLabsBase = () => process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

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
  const parsed = parseNarrator(narrator);
  const layout =
    parsed?.provider === "deepinfra"
      ? ["narrator-v1", "deepinfra", KOKORO_MODEL, parsed.voice, text]
      : parsed?.provider === "elevenlabs"
        ? ["narrator-v1", "elevenlabs", elevenLabsModel(), parsed.voice, text]
        : [model(), narrator, supportsInstructions() ? instructions() : "", endPad(), text];
  return `audio/${createHash("sha256").update(layout.join("\u0000")).digest("hex")}.mp3`;
}

// Narrated speech is never smaller than this per character (a 1500-char chunk is
// 80+ seconds of audio). Anything smaller is an empty or cut-off file.
const MIN_BYTES_PER_CHAR: Record<Provider, number> = { openai: 50, deepinfra: 30, elevenlabs: 30 };
const looksComplete = (audio: Buffer, text: string, narrator: string) =>
  audio.length >= text.length * MIN_BYTES_PER_CHAR[providerOf(narrator)];

const PROVIDER_NAME: Record<Provider, string> = { openai: "OpenAI", deepinfra: "DeepInfra", elevenlabs: "ElevenLabs" };

/** The request for one chunk, per provider. Everything else (retries, checks, usage) is shared. */
function buildRequest(input: string, narrator: string): { url: string; apiKey: string; body: Record<string, unknown>; provider: Provider; headers: Record<string, string> } {
  const parsed = parseNarrator(narrator) ?? { provider: "openai" as const, voice: narrator };
  const keyName = PROVIDER_KEY_ENV[parsed.provider];
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`${keyName} is not set.`);

  if (parsed.provider === "elevenlabs") {
    return {
      provider: "elevenlabs",
      url: `${elevenLabsBase()}/v1/text-to-speech/${encodeURIComponent(parsed.voice)}?output_format=mp3_44100_128`,
      apiKey,
      headers: { "xi-api-key": apiKey },
      body: { text: input, model_id: elevenLabsModel() },
    };
  }
  if (parsed.provider === "deepinfra") {
    return {
      provider: "deepinfra",
      headers: { Authorization: `Bearer ${apiKey}` },
      url: `${deepinfraBase()}/audio/speech`,
      apiKey,
      // DeepInfra defaults to WAV; chapters are joined by concatenating MP3 frames.
      body: { model: KOKORO_MODEL, voice: parsed.voice, input, response_format: "mp3" },
    };
  }
  const body: Record<string, unknown> = {
    model: model(),
    voice: parsed.voice,
    input: input + endPad(),
    response_format: "mp3",
  };
  if (supportsInstructions()) body.instructions = instructions();
  return {
    provider: "openai",
    headers: { Authorization: `Bearer ${apiKey}` },
    url: `${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/audio/speech`,
    apiKey,
    body,
  };
}

export async function synthChunk(input: string, narrator: string = defaultVoice()): Promise<Buffer> {
  const req = buildRequest(input, narrator);
  const name = PROVIDER_NAME[req.provider];
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
  return { done: true, audio: joinMp3(parts as Buffer[], { repair: providerOf(voice) === "deepinfra" }) };
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
