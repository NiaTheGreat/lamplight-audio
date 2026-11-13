import { NextResponse } from "next/server";
import { getFullSummary, patchItem, removeItem } from "@/lib/catalog/store";
import { deleteObject } from "@/lib/storage/storage";
import { ensureLibraryEntry } from "@/lib/storage/library";
import { BOOK_ID_RE } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function validId(ctx: Ctx): Promise<string | null> {
  const { id } = await ctx.params;
  return BOOK_ID_RE.test(id) ? id : null;
}

/** The full summary (the list only carries a clipped one). */
export async function GET(_req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  return NextResponse.json(
    { summary: (await getFullSummary(id)) ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * `{ userTags?: string[], complete?: boolean | null }` hand edits, or `{ action: "shelve" }` to put
 * the fic on the Shelf (done before narrating it).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    userTags?: unknown;
    complete?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (body.action === "shelve") {
    const ok = await ensureLibraryEntry(id);
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "Book not found." }, { status: 404 });
  }
  const userTags = Array.isArray(body.userTags)
    ? (body.userTags as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  const completeOverride =
    body.complete === null ? null : typeof body.complete === "boolean" ? body.complete : undefined;
  const item = await patchItem(id, { userTags, completeOverride });
  return item
    ? NextResponse.json(item)
    : NextResponse.json({ error: "That fic isn't in the library." }, { status: 404 });
}

/** Take a fic out of the library (and off the Shelf). Its text and any narration are kept. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const id = await validId(ctx);
  if (!id) return NextResponse.json({ error: "Bad book id." }, { status: 400 });
  await removeItem(id);
  await deleteObject(`library/${id}.json`).catch(() => {});
  return NextResponse.json({ ok: true });
}
