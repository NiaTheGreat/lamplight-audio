import { NextResponse } from "next/server";
import { NARRATOR_GROUPS, PROVIDER_KEY_ENV } from "@/lib/narrators-shared";

export const runtime = "nodejs";

/**
 * The narrators the UI offers, with whether each provider's key is set on the server.
 * Only a true/false is sent; the keys themselves never leave the server.
 */
export async function GET() {
  const groups = NARRATOR_GROUPS.map((g) => ({
    ...g,
    configured: Boolean(process.env[PROVIDER_KEY_ENV[g.provider]]),
    keyName: PROVIDER_KEY_ENV[g.provider],
  }));
  return NextResponse.json(groups, { headers: { "Cache-Control": "no-store" } });
}
