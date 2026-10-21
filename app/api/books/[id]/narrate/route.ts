import { NextResponse } from "next/server";
import { tokenFor } from "@/lib/auth";
import { cancelJob, getJob, startJob } from "@/lib/narration";
import { getObject } from "@/lib/storage";
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

/** Start (or resume) narrating the whole book in the background. */
export async function POST(req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });

  const raw = await getObject(`books/${id}.json`);
  if (!raw) return NextResponse.json({ error: "Book not found." }, { status: 404 });
  const book = JSON.parse(raw.toString("utf8")) as Book;

  const job = await startJob(id, book.chapters.length);

  const password = process.env.APP_PASSWORD;
  const token = password ? await tokenFor(password) : "";
  // The worker answers 202 straight away and works after the response.
  const kick = await fetch(`${new URL(req.url).origin}/api/worker/${id}`, {
    method: "POST",
    headers: { "x-worker-token": token },
  }).catch(() => null);
  if (!kick || !kick.ok) {
    return NextResponse.json({ error: "Couldn't start the background worker." }, { status: 502 });
  }
  return NextResponse.json(job);
}

/** Stop the job. Chapters already narrated are kept. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  await cancelJob(id);
  return NextResponse.json({ ok: true });
}
