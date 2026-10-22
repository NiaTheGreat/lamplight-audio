import { NextResponse } from "next/server";
import { PronunciationError } from "@/lib/pronunciation-store";
import { rereadChapter, type RereadOptions } from "@/lib/reread";

export const runtime = "nodejs";

/** Discard one narrated chapter's audio so it's narrated again on the next play. Body: `{ chapter, listId?, voice?, voiceForBook? }`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as ({ chapter?: unknown } & RereadOptions) | null;
  try {
    return NextResponse.json(await rereadChapter(id, body?.chapter, { listId: body?.listId, voice: body?.voice, voiceForBook: body?.voiceForBook }));
  } catch (err) {
    if (err instanceof PronunciationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't re-read that chapter." }, { status: 500 });
  }
}
