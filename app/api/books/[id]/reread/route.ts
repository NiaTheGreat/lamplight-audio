import { NextResponse } from "next/server";
import { PronunciationError } from "@/lib/pronunciation/pronunciation-store";
import { rereadChapter, rereadChapters, type RereadOptions } from "@/lib/narration/reread";

export const runtime = "nodejs";

/** Discard one narrated chapter's audio so it's narrated again on the next play. Body: `{ chapter | chapters: [..], listId?, voice?, voiceForBook? }`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as ({ chapter?: unknown; chapters?: unknown } & RereadOptions) | null;
  try {
    const opts = { listId: body?.listId, voice: body?.voice, voiceForBook: body?.voiceForBook };
    return NextResponse.json(body?.chapters !== undefined ? await rereadChapters(id, body.chapters, opts) : await rereadChapter(id, body?.chapter, opts));
  } catch (err) {
    if (err instanceof PronunciationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't re-read that chapter." }, { status: 500 });
  }
}
