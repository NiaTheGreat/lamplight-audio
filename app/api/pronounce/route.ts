import { serveBytes } from "@/lib/narration/http";
import { sanitizeNarrator } from "@/lib/narrators-shared";
import { getObject, putObject } from "@/lib/storage/storage";
import { audioKey, defaultVoice, synthChunk } from "@/lib/narration/tts";
import { flushUsage } from "@/lib/storage/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Hear how a respelling sounds in a narrator, without narrating a chapter: `?text=re-jee-na&voice=...`.
 * A few words cost a fraction of a cent, and each is kept so hearing it again is free.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const word = (url.searchParams.get("text") ?? "").trim().slice(0, 80);
  if (!word) return new Response("Nothing to say", { status: 400 });
  const voice = sanitizeNarrator(url.searchParams.get("voice")) ?? defaultVoice();
  const sentence = `Then ${word} walked in.`;
  const key = `previews/pron-${audioKey(sentence, voice).slice("audio/".length)}`;
  let audio = await getObject(key);
  if (!audio) {
    try {
      audio = await synthChunk(sentence, voice);
      await putObject(key, audio, "audio/mpeg");
      await flushUsage();
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Couldn't make that.", {
        status: 502,
      });
    }
  }
  return serveBytes(req, audio, "audio/mpeg");
}
