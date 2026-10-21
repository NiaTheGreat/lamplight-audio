import { serveBytes } from "@/lib/http";
import { getObject, putObject } from "@/lib/storage";
import { audioKey, synthesize } from "@/lib/tts";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";
// Long chapters can take a while to narrate. (Vercel Hobby caps this lower
// than 300s unless Fluid Compute is on; see README.)
export const maxDuration = 300;

// If the same chapter is requested twice at once (e.g. prefetch + play),
// only generate it once.
const inflight = new Map<string, Promise<Buffer>>();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; chapter: string }> },
) {
  const { id, chapter } = await params;
  if (!BOOK_ID_RE.test(id) || !/^\d{1,4}$/.test(chapter)) {
    return new Response("Bad request", { status: 400 });
  }

  const raw = await getObject(`books/${id}.json`);
  if (!raw) return new Response("Book not found. Upload the EPUB again.", { status: 404 });

  const book = JSON.parse(raw.toString("utf8")) as Book;
  const ch = book.chapters[Number(chapter)];
  if (!ch) return new Response("Chapter not found", { status: 404 });

  const key = audioKey(ch.text);
  let audio = await getObject(key);

  if (!audio) {
    let job = inflight.get(key);
    if (!job) {
      job = synthesize(ch.text)
        .then(async (buf) => {
          await putObject(key, buf, "audio/mpeg");
          return buf;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    try {
      audio = await job;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Narration failed.";
      return new Response(message, { status: 502 });
    }
  }

  const wantsDownload = new URL(req.url).searchParams.get("download") === "1";
  return serveBytes(
    req,
    audio,
    "audio/mpeg",
    wantsDownload
      ? { filename: `${book.title} - ${String(ch.index + 1).padStart(2, "0")} ${ch.title}.mp3` }
      : undefined,
  );
}
