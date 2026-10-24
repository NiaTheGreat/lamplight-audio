import { NextResponse } from "next/server";
import { getLists, saveLists } from "@/lib/pronunciation/pronlists";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getLists(), { headers: { "Cache-Control": "no-store" } });
}

/** Replace the named lists. Body: `{ lists: [{ id?, name, lines }], auto?: id }`. */
export async function PUT(req: Request) {
  return NextResponse.json(await saveLists(await req.json().catch(() => null)));
}
