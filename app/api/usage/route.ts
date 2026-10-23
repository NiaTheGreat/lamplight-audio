import { NextResponse } from "next/server";
import { getUsage } from "@/lib/storage/usage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getUsage(), { headers: { "Cache-Control": "no-store" } });
}
