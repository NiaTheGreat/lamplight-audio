import { NextResponse } from "next/server";
import { deleteObject, getObject, putObject } from "@/lib/storage";
import { BOOK_ID_RE, summarize, type Book, type LibraryEntry } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!BOOK_ID_RE.test(id)) {
    return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  }
  const raw = await getObject(`books/${id}.json`);
  if (!raw) return NextResponse.json({ error: "Book not found." }, { status: 404 });
  const summary = summarize(JSON.parse(raw.toString("utf8")) as Book);
  const entryRaw = await getObject(`library/${id}.json`);
  let hasEntry = false;
  if (entryRaw) {
    try {
      summary.narrated = (JSON.parse(entryRaw.toString("utf8")) as LibraryEntry).narrated ?? [];
      hasEntry = true;
    } catch {
      /* a bad entry is rebuilt below */
    }
  }
  // A stored book that never made it onto the shelf (or whose entry was lost) gets one.
  if (!hasEntry) {
    const entry: LibraryEntry = {
      id,
      title: summary.title,
      author: summary.author,
      chapterCount: summary.chapters.length,
      voice: summary.voice,
      addedAt: Date.now(),
      narrated: [],
    };
    await putObject(`library/${id}.json`, JSON.stringify(entry), "application/json");
  }
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}

/** Remove a book from the library. Its cached audio is kept, so re-uploading is free. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!BOOK_ID_RE.test(id)) {
    return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  }
  await deleteObject(`library/${id}.json`);
  return NextResponse.json({ ok: true });
}
