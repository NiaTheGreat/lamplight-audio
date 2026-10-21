import { serveBytes } from "@/lib/http";
import { markNarrated } from "@/lib/library";
import { getObject, hasObject, putObject } from "@/lib/storage";
import { audioKey, chapterProgress, defaultVoice, synthesizeChapter, type ChapterProgress } from "@/lib/tts";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";
// Long chapters can take a while to narrate. (Vercel Hobby caps this lower
// than 300s unless Fluid Compute is on; see README.)
export const maxDuration = 300;

// If the same chapter is requested twice at once (e.g. prefetch + play),
// only generate it once.
const inflight = new Map<string, Promise<ChapterProgress>>();

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

  const voice = book.voice ?? defaultVoice();
  const key = audioKey(ch.text, voice);

  if (new URL(req.url).searchParams.get("progress") === "1") {
    const done = await hasObject(key);
    const p = await chapterProgress(ch.text, voice);
    return Response.json(done ? { ready: p.total, total: p.total } : p, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  let audio = await getObject(key);

  if (!audio) {
    let job = inflight.get(key);
    if (!job) {
      job = synthesizeChapter(ch.text, undefined, voice)
        .then(async (result) => {
          if (result.done) {
            await putObject(key, result.audio, "audio/mpeg");
            await markNarrated(id, ch.index);
          }
          return result;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, job);
    }
    try {
      const result = await job;
      // Not finished within this request's time budget. Finished chunks are
      // cached, so the client just asks again and the work resumes.
      if (!result.done) {
        return Response.json(
          { ready: result.ready, total: result.total },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }
      audio = result.audio;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Narration failed.";
      return new Response(message, { status: 502 });
    }
  }

  // Books narrated before the library tracked this get caught up when played.
  if (req.headers.get("range") === "bytes=0-0") await markNarrated(id, ch.index);

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
