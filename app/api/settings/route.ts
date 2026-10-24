import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSettings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  return NextResponse.json(await saveSettings(body));
}
