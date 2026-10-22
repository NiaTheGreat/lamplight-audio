import { serveBytes } from "@/lib/http";
import { markNarrated } from "@/lib/library";
import { getObject, getPublicUrl, hasObject, putObject } from "@/lib/storage";
import { inspectMp3 } from "@/lib/mp3";
import { voiceFor } from "@/lib/chaptervoice";
import { setLive } from "@/lib/live";
import { spokenText } from "@/lib/pronunciation";
import {
  audioKey,
  chapterProgress,
  synthesizeChapter,
  type ChapterProgress,
} from "@/lib/tts";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";
// Long chapters can take a while to narrate. (Vercel Hobby caps this lower
// than 300s unless Fluid Compute is on; see README.)
export const maxDuration = 300;

// If the same chapter is requested twice at once (e.g. prefetch + play),
// only generate it once.
const inflight = new Map<string, Promise<ChapterProgress>>();

/**
 * Query modes:
 *  ?progress=1  how many chunks are cached so far
 *  ?prepare=1   make sure the chapter exists (narrating it if needed); no audio bytes
 *  ?download=1  the MP3 as a named download, served by this function
 *  (none)       the audio itself: redirected to its public CDN address when there
 *               is one, so the browser streams it without routing bytes through us
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; chapter: string }> },
) {
  const { id, chapter } = await params;
  if (!BOOK_ID_RE.test(id) || !/^\d{1,4}$/.test(chapter)) {
    return new Response("Bad request", { status: 400 });
  }
  const query = new URL(req.url).searchParams;

  const raw = await getObject(`books/${id}.json`);
  if (!raw) return new Response("Book not found. Upload the EPUB again.", { status: 404 });

  const book = JSON.parse(raw.toString("utf8")) as Book;
  const ch = book.chapters[Number(chapter)];
  if (!ch) return new Response("Chapter not found", { status: 404 });

  const voice = voiceFor(book, ch.index);
  const spoken = spokenText(book, ch.index, ch.text);
  const key = audioKey(spoken, voice);

  // ?inspect=1: describe the saved MP3 (headers, frames, length) to diagnose seeking problems.
  if (query.get("inspect") === "1") {
    const audio = await getObject(key);
    if (!audio) return Response.json({ error: "Not narrated yet." }, { status: 404 });
    return Response.json({ voice, key, ...inspectMp3(audio) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (query.get("progress") === "1") {
    const done = await hasObject(key);
    const p = await chapterProgress(spoken, voice);
    return Response.json(done ? { ready: p.total, total: p.total } : p, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const generate = () => {
    let job = inflight.get(key);
    if (!job) {
      job = (async () => {
        // Shows up in the queue while it's being narrated.
        await setLive(id, ch.index, true);
        try {
          const result = await synthesizeChapter(spoken, undefined, voice);
          if (result.done) {
            await putObject(key, result.audio, "audio/mpeg");
            await markNarrated(id, ch.index);
          }
          return result;
        } finally {
          await setLive(id, ch.index, false);
          inflight.delete(key);
        }
      })();
      inflight.set(key, job);
    }
    return job;
  };

  // Not finished within this request's time budget. Finished chunks are
  // cached, so the client just asks again and the work resumes.
  const notYet = (r: { ready: number; total: number }) =>
    Response.json(
      { ready: r.ready, total: r.total },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );

  if (query.get("prepare") === "1") {
    if (await hasObject(key)) {
      // Books narrated before the library tracked this get caught up here.
      await markNarrated(id, ch.index);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    try {
      const result = await generate();
      if (!result.done) return notYet(result);
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Narration failed.", { status: 502 });
    }
  }

  const wantsDownload = query.get("download") === "1";

  if (!wantsDownload) {
    const url = await getPublicUrl(key);
    if (url) {
      return new Response(null, {
        status: 307,
        headers: { Location: url, "Cache-Control": "private, max-age=3600" },
      });
    }
  }

  let audio = await getObject(key);
  if (!audio) {
    try {
      const result = await generate();
      if (!result.done) return notYet(result);
      audio = result.audio;
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "Narration failed.", { status: 502 });
    }
  }

  return serveBytes(
    req,
    audio,
    "audio/mpeg",
    wantsDownload
      ? { filename: `${book.title} - ${String(ch.index + 1).padStart(2, "0")} ${ch.title}.mp3` }
      : undefined,
  );
}
