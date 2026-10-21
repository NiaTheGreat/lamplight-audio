import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { del, get, list, put } from "@vercel/blob";

/**
 * Tiny key/value store for parsed books and generated audio.
 *  - With BLOB_READ_WRITE_TOKEN set (Vercel Blob), objects live in Blob storage.
 *  - Otherwise they are written to ./.cache (or /tmp on Vercel), which is fine
 *    for local development.
 * Keys are always hex-hash based, never user-supplied paths.
 */
const isImmutable = (key: string) => key.startsWith("audio/") || key.startsWith("previews/");
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const localRoot = () =>
  process.env.CACHE_DIR ||
  (process.env.VERCEL ? "/tmp/audiobook-cache" : path.join(process.cwd(), ".cache"));

export async function putObject(
  key: string,
  data: Buffer | string,
  contentType: string,
): Promise<void> {
  if (useBlob()) {
    await put(key, data, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      // Records we rewrite (library, settings, progress, jobs) must not be served
      // stale, so they get a short cache. Audio is named by a hash of its content
      // and never changes, so it can be cached for a year.
      cacheControlMaxAge: isImmutable(key) ? 31_536_000 : 60,
    });
    return;
  }
  const file = path.join(localRoot(), key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so stopping the server mid-write can't leave a partial file.
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** Retry a flaky network read a couple of times before giving up. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** i));
    }
  }
  throw lastError;
}

/** Read through the public CDN address. Kept as a fallback for the authenticated read below. */
async function readViaPublicUrl(key: string): Promise<Buffer | null> {
  const { blobs } = await list({ prefix: key, limit: 5 });
  const hit = blobs.find((b) => b.pathname === key);
  if (!hit) return null;
  // The upload time in the URL makes every overwrite a fresh cache entry.
  const res = await fetch(`${hit.url}?v=${new Date(hit.uploadedAt).getTime()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Storage read failed (${res.status}) for ${key}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Read an object. Returns null only when it genuinely isn't there. A read that
 * keeps failing throws, so callers never mistake a hiccup for "missing" (which
 * would make books vanish from the shelf, or re-narrate audio that exists).
 *
 * Blob reads go through the SDK with the store's own token. Records we rewrite
 * bypass the CDN cache so they are never stale; audio (immutable) may use it.
 */
export async function getObject(key: string): Promise<Buffer | null> {
  if (useBlob()) {
    return withRetry(async () => {
      try {
        const result = await get(key, { access: "public", useCache: isImmutable(key) });
        if (!result) return null;
        if (result.statusCode !== 200 || !result.stream) return null;
        return Buffer.from(await new Response(result.stream).arrayBuffer());
      } catch (err) {
        // If the authenticated read fails for any reason, try the public address once.
        try {
          return await readViaPublicUrl(key);
        } catch {
          throw err;
        }
      }
    });
  }
  try {
    return await fs.readFile(path.join(localRoot(), key));
  } catch {
    return null;
  }
}

/** Cheap existence check, so progress polling doesn't download audio. */
export async function hasObject(key: string): Promise<boolean> {
  if (useBlob()) {
    const { blobs } = await list({ prefix: key, limit: 5 });
    return blobs.some((b) => b.pathname === key);
  }
  try {
    await fs.access(path.join(localRoot(), key));
    return true;
  } catch {
    return false;
  }
}

/** Keys under a prefix (e.g. "library/"), for listing saved books. */
/**
 * The direct CDN address of an object, or null when objects aren't served
 * from a public URL (local development). Lets the browser stream audio from
 * Blob instead of routing every byte through a function.
 */
export async function getPublicUrl(key: string): Promise<string | null> {
  if (!useBlob()) return null;
  return withRetry(async () => {
    const { blobs } = await list({ prefix: key, limit: 5 });
    return blobs.find((b) => b.pathname === key)?.url ?? null;
  });
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (useBlob()) {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      keys.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
  try {
    const names = await fs.readdir(path.join(localRoot(), prefix));
    return names.map((n) => `${prefix}${n}`);
  } catch {
    return [];
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (useBlob()) {
    const { blobs } = await list({ prefix: key, limit: 5 });
    const hit = blobs.find((b) => b.pathname === key);
    if (hit) await del(hit.url);
    return;
  }
  await fs.rm(path.join(localRoot(), key), { force: true });
}
