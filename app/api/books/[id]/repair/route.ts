import { NextResponse } from "next/server";
import { PronunciationError } from "@/lib/pronunciation-store";
import { repairBook } from "@/lib/repair";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Rebuild narrated chapters from their saved pieces without narrating anything (free). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await repairBook(id));
  } catch (err) {
    if (err instanceof PronunciationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't repair this book." }, { status: 500 });
  }
}
