import { NextResponse } from "next/server";
import { getReading, saveReading } from "@/lib/storage/reading";
import { BOOK_ID_RE } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getReading(), { headers: { "Cache-Control": "no-store" } });
}

/** `{ id, chapter?, done?, total?, finished? }`: where the reader is, or mark finished / unread. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    chapter?: unknown;
    done?: unknown;
    total?: unknown;
    finished?: unknown;
  } | null;
  if (!body || typeof body.id !== "string" || !BOOK_ID_RE.test(body.id)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  return NextResponse.json(
    await saveReading({
      id: body.id,
      chapter: typeof body.chapter === "number" ? body.chapter : undefined,
      done: body.done === true,
      total: typeof body.total === "number" ? body.total : undefined,
      finished: typeof body.finished === "boolean" ? body.finished : undefined,
    }),
  );
}
