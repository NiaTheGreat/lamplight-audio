import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

// A deployed copy of this app spends your OpenAI credits, so it sits behind a
// single shared password (APP_PASSWORD). Locally, with no password set, it is open.
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("APP_PASSWORD is not configured.", { status: 500 });
    }
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login" || pathname === "/api/health") {
    return NextResponse.next();
  }

  // The background worker calls itself without a browser cookie.
  const workerToken = req.headers.get("x-worker-token");
  if (
    pathname.startsWith("/api/worker/") &&
    workerToken &&
    workerToken === (await tokenFor(password))
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await tokenFor(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return new NextResponse("Unauthorized", { status: 401 });

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
