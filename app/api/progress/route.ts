import { NextResponse } from "next/server";
import { getProgress, savePosition } from "@/lib/storage/progress";
import { BOOK_ID_RE } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getProgress(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    chapter?: number;
    time?: number;
  } | null;
  if (!body || !BOOK_ID_RE.test(body.id ?? "") || typeof body.chapter !== "number") {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  return NextResponse.json(await savePosition(body.id!, body.chapter, Number(body.time) || 0));
}
