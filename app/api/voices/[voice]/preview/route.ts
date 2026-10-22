import { serveBytes } from "@/lib/http";
import { sanitizeNarrator } from "@/lib/narrators-shared";
import { getObject, putObject } from "@/lib/storage";
import { audioKey, synthChunk } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAMPLE =
  "The rain fell softly on the old house. She listened, and did not move, until morning came slowly.";

/** A few seconds of a narrator (an OpenAI voice name or e.g. "deepinfra:kokoro:af_bella"), made once and kept. */
export async function GET(req: Request, { params }: { params: Promise<{ voice: string }> }) {
  const { voice: rawVoice } = await params;
  const voice = sanitizeNarrator(decodeURIComponent(rawVoice));
  if (!voice) return new Response("Unknown voice", { status: 404 });
  const key = `previews/${audioKey(SAMPLE, voice).slice("audio/".length)}`;
  let audio = await getObject(key);
  if (!audio) {
    try {
      audio = await synthChunk(SAMPLE, voice);
      await putObject(key, audio, "audio/mpeg");
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Preview failed.", { status: 502 });
    }
  }
  return serveBytes(req, audio, "audio/mpeg");
}
