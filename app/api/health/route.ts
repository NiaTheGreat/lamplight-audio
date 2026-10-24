export const dynamic = "force-dynamic";

/** Liveness check for Docker and `doctor`. Open to everyone and reveals nothing. */
export function GET() {
  return Response.json({ ok: true });
}
