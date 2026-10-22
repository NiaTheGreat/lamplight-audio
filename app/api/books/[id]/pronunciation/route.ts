import { NextResponse } from "next/server";
import { getPronunciations, PronunciationError, renarrate, savePronunciations } from "@/lib/pronunciation-store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function run(ctx: Ctx, fn: (id: string) => Promise<unknown>) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await fn(id), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof PronunciationError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Couldn't use the pronunciation list." }, { status: 500 });
  }
}

/** The book's pronunciation lines and which narrated chapters still use older ones. */
export const GET = (_req: Request, ctx: Ctx) => run(ctx, getPronunciations);

/** Replace the book's lines. Body: `{ lines: [{ from, to }] }`. */
export async function PUT(req: Request, ctx: Ctx) {
  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null;
  return run(ctx, (id) => savePronunciations(id, body?.lines));
}

/** Re-read narrated chapters with the current lines. Body: `{ chapters?: number[] }` (none = all). */
export async function POST(req: Request, ctx: Ctx) {
  const body = (await req.json().catch(() => null)) as { chapters?: unknown } | null;
  return run(ctx, (id) => renarrate(id, body?.chapters));
}
