import { NextResponse } from "next/server";
import { readerEnabled } from "@/lib/reader/flag";
import { attachEpubToBook } from "@/lib/reader/attach";
import { hasReaderBook } from "@/lib/reader/store";
import { getObject } from "@/lib/storage/storage";
import { BOOK_ID_RE, type Book } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Is the reader on, and has this book got its EPUB saved? */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readerEnabled()) return NextResponse.json({ enabled: false, hasEpub: false });
  if (!BOOK_ID_RE.test(id)) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  return NextResponse.json({ enabled: true, hasEpub: await hasReaderBook(id) });
}

/** Attach the EPUB to a book added before the reader existed (multipart `file`). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!readerEnabled())
    return NextResponse.json({ error: "The reader is turned off." }, { status: 404 });
  if (!BOOK_ID_RE.test(id)) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  const raw = await getObject(`books/${id}.json`);
  if (!raw) return NextResponse.json({ error: "Book not found." }, { status: 404 });

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Couldn't read the upload." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an EPUB file first." }, { status: 400 });
  }
  const result = await attachEpubToBook(
    JSON.parse(raw.toString("utf8")) as Book,
    Buffer.from(await file.arrayBuffer()),
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
