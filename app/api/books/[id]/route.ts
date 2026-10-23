import { NextResponse } from "next/server";
import { deleteObject, getObject, putObject } from "@/lib/storage/storage";
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
  // A shelf entry that can't be read is treated like a missing one and rebuilt below.
  const entryRaw = await getObject(`library/${id}.json`).catch(() => null);
  let hasEntry = false;
  if (entryRaw) {
    try {
      const entry = JSON.parse(entryRaw.toString("utf8")) as LibraryEntry;
      summary.narrated = entry.narrated ?? [];
      hasEntry = true;
      // Entries made before chapter lengths were recorded get them now, so the shelf can show a cost.
      if (!entry.chars) {
        entry.chars = summary.chapters.map((c) => c.chars);
        await putObject(`library/${id}.json`, JSON.stringify(entry), "application/json").catch(() => {});
      }
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
      chars: summary.chapters.map((c) => c.chars),
    };
    await putObject(`library/${id}.json`, JSON.stringify(entry), "application/json").catch(() => {});
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
