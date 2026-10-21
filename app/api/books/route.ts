import { NextResponse } from "next/server";
import { parseEpub } from "@/lib/epub";
import { getSettings } from "@/lib/settings";
import { getObject, listKeys, putObject } from "@/lib/storage";
import { summarize, type Book, type LibraryEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The saved library, newest first. */
export async function GET() {
  let keys: string[];
  try {
    keys = await listKeys("library/");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read the library.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  const entries = await Promise.all(
    keys.map(async (key) => {
      try {
        const raw = await getObject(key);
        return raw ? (JSON.parse(raw.toString("utf8")) as LibraryEntry) : null;
      } catch {
        return null;
      }
    }),
  );
  const books = entries.filter((e): e is LibraryEntry => e !== null);
  books.sort((a, b) => b.addedAt - a.addedAt);
  return NextResponse.json(books, { headers: { "Cache-Control": "no-store" } });
}

/** Upload an EPUB, parse it into chapters, and store the parsed book. */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read the upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an EPUB file first." }, { status: 400 });
  }

  const skipNotes = form.get("skipNotes") !== "false";

  try {
    const book = await parseEpub(Buffer.from(await file.arrayBuffer()), { skipNotes });
    // A book keeps the voice it was first added with, so it never changes mid-story.
    const existing = await getObject(`books/${book.id}.json`);
    const keepVoice = existing
      ? (JSON.parse(existing.toString("utf8")) as Book).voice
      : undefined;
    book.voice = keepVoice ?? (await getSettings()).voice;
    await putObject(`books/${book.id}.json`, JSON.stringify(book), "application/json");
    const entry: LibraryEntry = {
      id: book.id,
      title: book.title,
      author: book.author,
      chapterCount: book.chapters.length,
      voice: book.voice,
      addedAt: Date.now(),
    };
    await putObject(`library/${book.id}.json`, JSON.stringify(entry), "application/json");
    return NextResponse.json(summarize(book));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read that EPUB.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
