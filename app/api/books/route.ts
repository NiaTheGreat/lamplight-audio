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
  let entries: (LibraryEntry | null)[];
  try {
    entries = await Promise.all(
      keys.map(async (key) => {
        const raw = await getObject(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw.toString("utf8")) as LibraryEntry;
        } catch {
          return null; // a corrupt entry is skipped; it is rebuilt when the book is opened
        }
      }),
    );
  } catch (err) {
    // A storage hiccup must not look like a shorter shelf: report it so the page keeps what it has.
    const message = err instanceof Error ? err.message : "Couldn't read the library.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
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
