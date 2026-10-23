import { NextResponse } from "next/server";
import { PronunciationError } from "@/lib/pronunciation/pronunciation-store";
import { repairBook } from "@/lib/narration/repair";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Rebuild narrated chapters (or one: `{ chapter }`) from their saved pieces without narrating anything (free). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { chapter?: unknown } | null;
  const only = typeof body?.chapter === "number" ? body.chapter : undefined;
  try {
    return NextResponse.json(await repairBook(id, only));
  } catch (err) {
    if (err instanceof PronunciationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't repair this book." }, { status: 500 });
  }
}
