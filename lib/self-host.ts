// Settings that only matter when the app runs on your own machine instead of Vercel.

/**
 * Where the background worker calls itself. Defaults to the address the request
 * came in on, which is right on Vercel and on localhost. Behind a reverse proxy
 * that address can be the public one, so self-hosters set WORKER_ORIGIN
 * (the Docker image sets it to the container's own port).
 */
export function workerOrigin(req: Request, env: Partial<NodeJS.ProcessEnv> = process.env): string {
  const set = env.WORKER_ORIGIN?.trim().replace(/\/+$/, "");
  return set || new URL(req.url).origin;
}

/**
 * Whether the login cookie is marked Secure. Browsers drop Secure cookies on
 * plain http, so a home server reached at http://192.168.x.x:3000 sets
 * COOKIE_SECURE=false. Anything else keeps the old rule: secure in production.
 */
export function cookieSecure(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  if (env.COOKIE_SECURE === "false") return false;
  if (env.COOKIE_SECURE === "true") return true;
  return env.NODE_ENV === "production";
}
