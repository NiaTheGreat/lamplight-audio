import { NextResponse } from "next/server";
import { tokenFor } from "@/lib/auth";
import { setChapterVoice, NarratorChangeError } from "@/lib/narration/narrator";
import { cancelJob, clampRange, getJob, isJobActive, pauseJob, resumeJob, startJob } from "@/lib/narration/narration";
import { getObject } from "@/lib/storage/storage";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function validId(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return BOOK_ID_RE.test(id) ? id : null;
}

/** Current background-narration job for a book (null if none). */
export async function GET(_req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  return NextResponse.json(await getJob(id), { headers: { "Cache-Control": "no-store" } });
}

/** Start (or resume) narrating chapters of the book in the background. */
export async function POST(req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });

  const raw = await getObject(`books/${id}.json`);
  if (!raw) return NextResponse.json({ error: "Book not found." }, { status: 404 });
  const book = JSON.parse(raw.toString("utf8")) as Book;

  // Optional { from, to } picks which chapters (0-based, inclusive), or { chapters: [..] } exact ones; none means the whole book.
  const range = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown; chapters?: unknown; voice?: unknown; onlyIfIdle?: unknown } | null;
  // { onlyIfIdle: true }: used when pressing play, which must never replace a job that's already
  // running or paused for this book. The caller then narrates directly instead.
  if (range?.onlyIfIdle === true) {
    const current = await getJob(id);
    if (current && (isJobActive(current) || current.status === "paused")) {
      return NextResponse.json({ error: "Another narration is already running for this book." }, { status: 409 });
    }
  }
  // Optional { voice }: narrate these chapters in that voice (the fic's own voice is unchanged).
  if (typeof range?.voice === "string" && range.voice) {
    const { from, to } = clampRange(book.chapters.length, range.from, range.to);
    const indices = Array.isArray(range.chapters)
      ? range.chapters.filter((c): c is number => Number.isInteger(c))
      : Array.from({ length: to - from + 1 }, (_, k) => from + k);
    try {
      await setChapterVoice(id, indices, range.voice);
    } catch (err) {
      if (err instanceof NarratorChangeError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  }
  const job = await startJob(id, book.chapters.length, range ?? undefined, range?.chapters);

  return kickWorker(req, id, job);
}

/** The worker answers 202 straight away and works after the response. */
async function kickWorker(req: Request, id: string, job: unknown) {
  const password = process.env.APP_PASSWORD;
  const token = password ? await tokenFor(password) : "";
  const kick = await fetch(`${new URL(req.url).origin}/api/worker/${id}`, {
    method: "POST",
    headers: { "x-worker-token": token },
  }).catch(() => null);
  if (!kick || !kick.ok) {
    return NextResponse.json({ error: "Couldn't start the background worker." }, { status: 502 });
  }
  return NextResponse.json(job);
}

/** Pause, resume or cancel the job: { action: "pause" | "resume" | "cancel" }. */
export async function PATCH(req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  switch (body?.action) {
    case "pause":
      return NextResponse.json(await pauseJob(id));
    case "cancel":
      await cancelJob(id);
      return NextResponse.json(await getJob(id));
    case "resume": {
      const job = await resumeJob(id);
      if (!job) return NextResponse.json({ error: "Nothing to resume." }, { status: 404 });
      return job.status === "running" ? kickWorker(req, id, job) : NextResponse.json(job);
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}

/** Stop the job. Chapters already narrated are kept. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  await cancelJob(id);
  return NextResponse.json({ ok: true });
}
