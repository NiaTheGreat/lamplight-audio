import { NextResponse } from "next/server";
import { listQueue } from "@/lib/narration";
import { getSpeed } from "@/lib/speed";

export const runtime = "nodejs";

/** Books with a narration job that is running, paused or failed, plus measured narration speed. */
export async function GET() {
  try {
    const [items, speed] = await Promise.all([listQueue(), getSpeed()]);
    return NextResponse.json({ items, speed }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't read the queue.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
