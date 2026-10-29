import { NextResponse } from "next/server";
import { getUsage, setMonthlyBudgetUsd } from "@/lib/storage/usage";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getUsage(), { headers: { "Cache-Control": "no-store" } });
}

/** Body: `{ limitUsd: number }` to set the monthly limit, or `{ limitUsd: null }` to use the default. */
export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { limitUsd?: unknown } | null;
  const v = body?.limitUsd;
  if (v !== null && (typeof v !== "number" || !Number.isFinite(v)))
    return NextResponse.json({ error: "limitUsd must be a number or null." }, { status: 400 });
  try {
    await setMonthlyBudgetUsd(v);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json(await getUsage(), { headers: { "Cache-Control": "no-store" } });
}
