import { NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const submitted = String(form.get("password") ?? "");
  const expected = process.env.APP_PASSWORD;

  if (!expected || submitted !== expected) {
    return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
  }

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
