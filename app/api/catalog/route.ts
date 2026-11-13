import { NextResponse } from "next/server";
import { readCatalog, refreshItems } from "@/lib/catalog/store";
import { readerEnabled } from "@/lib/reader/flag";
import { BOOK_ID_RE } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** The Browse list: every fic with its details (one storage read). */
export async function GET() {
  try {
    const { items } = await readCatalog();
    return NextResponse.json(
      { items, reader: readerEnabled() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read the library.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Read details for books already stored (from their kept EPUB). `{ ids }`, at most 8 at a time. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter(
        (i): i is string => typeof i === "string" && BOOK_ID_RE.test(i),
      )
    : [];
  if (ids.length === 0 || ids.length > 8) {
    return NextResponse.json({ error: "Send between 1 and 8 book ids." }, { status: 400 });
  }
  try {
    return NextResponse.json({ done: await refreshItems(ids) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read those books.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
