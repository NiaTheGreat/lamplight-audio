import { NextResponse } from "next/server";
import { parseEpub } from "@/lib/epub";
import { getSettings, sanitizeVoice } from "@/lib/settings";
import { deleteObject, getObject, listKeys, putObject } from "@/lib/storage";
import { isUploadKey } from "@/lib/uploads";
import { BOOK_ID_RE, summarize, type Book, type LibraryEntry } from "@/lib/types";

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
  const entries: (LibraryEntry | null)[] = await Promise.all(
    keys.map(async (key) => {
      try {
        const raw = await getObject(key);
        if (!raw) return null;
        return JSON.parse(raw.toString("utf8")) as LibraryEntry;
      } catch {
        // One unreadable entry must not hide the book or break the whole shelf.
        // Show a placeholder; opening the book rebuilds its entry.
        const id = key.replace(/^library\//, "").replace(/\.json$/, "");
        if (!BOOK_ID_RE.test(id)) return null;
        return { id, title: "Couldn't read this book's details. Tap to repair.", chapterCount: 0, addedAt: 0 };
      }
    }),
  );
  const books = entries.filter((e): e is LibraryEntry => e !== null);
  books.sort((a, b) => b.addedAt - a.addedAt);
  return NextResponse.json(books, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Add an EPUB. Either the file is posted here as multipart form data (small
 * files), or JSON `{ uploadKey, skipNotes }` names a file the browser already
 * uploaded straight to storage (large files, which Vercel won't accept in a body).
 */
export async function POST(req: Request) {
  let buf: Buffer;
  let skipNotes = true;
  let chosenVoice: string | undefined;
  let uploadKey: string | null = null;

  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      uploadKey?: unknown;
      skipNotes?: unknown;
      voice?: unknown;
    } | null;
    if (!body || !isUploadKey(body.uploadKey)) {
      return NextResponse.json({ error: "Couldn't find that upload." }, { status: 400 });
    }
    uploadKey = body.uploadKey;
    skipNotes = body.skipNotes !== false;
    chosenVoice = sanitizeVoice(body.voice);
    let stored: Buffer | null;
    try {
      stored = await getObject(uploadKey);
    } catch {
      return NextResponse.json({ error: "Couldn't read the uploaded file from storage." }, { status: 502 });
    }
    if (!stored) {
      return NextResponse.json({ error: "The uploaded file wasn't found. Try uploading it again." }, { status: 404 });
    }
    buf = stored;
  } else {
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
    skipNotes = form.get("skipNotes") !== "false";
    chosenVoice = sanitizeVoice(form.get("voice"));
    buf = Buffer.from(await file.arrayBuffer());
  }

  try {
    const book = await parseEpub(buf, { skipNotes });
    // A book keeps the voice it was first added with, so it never changes mid-story.
    const existing = await getObject(`books/${book.id}.json`);
    const keepVoice = existing
      ? (JSON.parse(existing.toString("utf8")) as Book).voice
      : undefined;
    book.voice = keepVoice ?? chosenVoice ?? (await getSettings()).voice;
    await putObject(`books/${book.id}.json`, JSON.stringify(book), "application/json");
    const entry: LibraryEntry = {
      id: book.id,
      title: book.title,
      author: book.author,
      chapterCount: book.chapters.length,
      voice: book.voice,
      addedAt: Date.now(),
      chars: book.chapters.map((c) => c.text.length),
    };
    await putObject(`library/${book.id}.json`, JSON.stringify(entry), "application/json");
    return NextResponse.json(summarize(book));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read that EPUB.";
    return NextResponse.json({ error: message }, { status: 422 });
  } finally {
    // The raw upload has served its purpose either way.
    if (uploadKey) await deleteObject(uploadKey).catch(() => {});
  }
}
