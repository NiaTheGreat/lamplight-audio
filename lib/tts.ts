import { createHash } from "node:crypto";
import { splitForTts } from "./text";

const model = () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const voice = () => process.env.OPENAI_TTS_VOICE || "coral";
const supportsInstructions = () => model().startsWith("gpt-4o");
const instructions = () =>
  process.env.TTS_INSTRUCTIONS ||
  "Read this aloud as a warm, natural audiobook narrator. Keep a steady pace and give dialogue a little life.";

/** Cache key: same text + same voice settings => same audio, generated once. */
export function audioKey(text: string): string {
  const hash = createHash("sha256")
    .update(
      [model(), voice(), supportsInstructions() ? instructions() : "", text].join("\u0000"),
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
    input,
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

    lastError = `OpenAI TTS error ${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Only retry rate limits and server errors.
    if (res.status !== 429 && res.status < 500) break;
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

/** Turn a chapter's text into one MP3 buffer. */
export async function synthesize(text: string): Promise<Buffer> {
  const chunks = splitForTts(text);
  const parts = await mapLimit(chunks, 3, (chunk) => synthChunk(chunk));
  // MP3 frames can simply be concatenated.
  return Buffer.concat(parts);
}
