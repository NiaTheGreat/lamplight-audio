import { NextResponse } from "next/server";
import { getSpeed } from "@/lib/storage/speed";

export const runtime = "nodejs";

/** Measured narration speed per provider, for time estimates. */
export async function GET() {
  return NextResponse.json(await getSpeed(), { headers: { "Cache-Control": "no-store" } });
}
