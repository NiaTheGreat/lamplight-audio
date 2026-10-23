import { NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";
import { clearFailures, isBlocked, recordFailure } from "@/lib/storage/throttle";

export async function POST(req: Request) {
  const form = await req.formData();
  const submitted = String(form.get("password") ?? "");
  const expected = process.env.APP_PASSWORD;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";

  if (await isBlocked(ip).catch(() => false)) {
    return NextResponse.redirect(new URL("/login?error=locked", req.url), 303);
  }
  if (!expected || submitted !== expected) {
    await recordFailure(ip).catch(() => {});
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }
  await clearFailures(ip).catch(() => {});

  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(AUTH_COOKIE, await tokenFor(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
