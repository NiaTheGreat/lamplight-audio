import { NextResponse } from "next/server";
import { changeNarrator, NarratorChangeError } from "@/lib/narrator";

export const runtime = "nodejs";

/** Change the narrator of a book that has nothing narrated yet. Body: `{ narrator }`. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { narrator?: unknown } | null;
  try {
    const narrator = await changeNarrator(id, body?.narrator);
    return NextResponse.json({ narrator });
  } catch (err) {
    if (err instanceof NarratorChangeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Couldn't change the narrator." }, { status: 500 });
  }
}
