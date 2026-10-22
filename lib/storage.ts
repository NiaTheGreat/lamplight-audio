import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AwsClient } from "aws4fetch";

/**
 * Tiny key/value store for parsed books and generated audio.
 *  - With the R2_* variables set, objects live in a Cloudflare R2 bucket (S3 API).
 *  - Otherwise they are written to ./.cache (or CACHE_DIR), which is fine for
 *    local development. On Vercel that disk is wiped between runs, so storage
 *    must be configured there.
 * Keys are always hex-hash based, never user-supplied paths.
 */
const isImmutable = (key: string) => key.startsWith("audio/") || key.startsWith("previews/");

const r2 = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    bucket,
    base: `${endpoint}/${bucket}`,
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  };
};

const localRoot = () =>
  process.env.CACHE_DIR ||
  (process.env.VERCEL ? "/tmp/audiobook-cache" : path.join(process.cwd(), ".cache"));

/** Where we are running without storage configured, and would silently lose data. */
function assertDurable(): void {
  if (process.env.VERCEL && !process.env.CACHE_DIR && !r2()) {
    throw new Error(
      "Storage isn't configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.",
    );
  }
}

const objectUrl = (base: string, key: string) =>
  `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Retry a flaky network call a couple of times before giving up. */
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

/**
 * One signed request to the bucket. 5xx/429 throw so withRetry tries again.
 *
 * The request is signed first and then sent with a plain fetch and the body
 * as raw bytes. Handing aws4fetch's own Request object to fetch can make some
 * runtimes stream the body (chunked, no Content-Length), which R2 rejects
 * with 411, so the size is also declared explicitly.
 */
async function r2Fetch(
  store: NonNullable<ReturnType<typeof r2>>,
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array },
): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  let body: Uint8Array | undefined;
  if (init.body !== undefined) {
    body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body;
    headers["Content-Length"] = String(body.byteLength);
  }
  const signed = await store.client.sign(url, { method: init.method, headers });
  const res = await fetch(signed.url, {
    method: init.method,
    headers: signed.headers,
    body: body as BodyInit | undefined,
  });
  if (res.status >= 500 || res.status === 429) {
    throw new Error(`Storage error (${res.status}) for ${init.method} ${url}`);
  }
  return res;
}

export async function putObject(
  key: string,
  data: Buffer | string,
  contentType: string,
): Promise<void> {
  assertDurable();
  const store = r2();
  if (store) {
    await withRetry(async () => {
      const res = await r2Fetch(store, objectUrl(store.base, key), {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          // Audio is named by a hash of its content and never changes.
          "Cache-Control": isImmutable(key) ? "public, max-age=31536000, immutable" : "no-store",
        },
        body: typeof data === "string" ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      });
      if (!res.ok) throw new Error(`Storage write failed (${res.status}) for ${key}`);
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

/**
 * Read an object. Returns null only when it genuinely isn't there. A read that
 * keeps failing throws, so callers never mistake a hiccup for "missing" (which
 * would make books vanish from the shelf, or re-narrate audio that exists).
 */
export async function getObject(key: string): Promise<Buffer | null> {
  assertDurable();
  const store = r2();
  if (store) {
    return withRetry(async () => {
      const res = await r2Fetch(store, objectUrl(store.base, key), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage read failed (${res.status}) for ${key}`);
      return Buffer.from(await res.arrayBuffer());
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
  assertDurable();
  const store = r2();
  if (store) {
    return withRetry(async () => {
      const res = await r2Fetch(store, objectUrl(store.base, key), { method: "HEAD" });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(`Storage check failed (${res.status}) for ${key}`);
      return true;
    });
  }
  try {
    await fs.access(path.join(localRoot(), key));
    return true;
  } catch {
    return false;
  }
}

/**
 * A temporary direct address for an object, or null when objects aren't served
 * from a bucket (local development) or it doesn't exist. Lets the browser
 * stream audio straight from R2 instead of routing every byte through a
 * function. The bucket stays private; the address stops working after an hour.
 */
export async function getPublicUrl(key: string): Promise<string | null> {
  const store = r2();
  if (!store) return null;
  if (!(await hasObject(key))) return null;
  const url = new URL(objectUrl(store.base, key));
  url.searchParams.set("X-Amz-Expires", "3600");
  const signed = await store.client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}

/** Keys under a prefix (e.g. "library/"), for listing saved books. */
export async function listKeys(prefix: string): Promise<string[]> {
  assertDurable();
  const store = r2();
  if (store) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const url = new URL(store.base);
      url.searchParams.set("list-type", "2");
      url.searchParams.set("prefix", prefix);
      if (token) url.searchParams.set("continuation-token", token);
      const xml = await withRetry(async () => {
        const res = await r2Fetch(store, url.toString(), { method: "GET" });
        if (!res.ok) throw new Error(`Storage list failed (${res.status}) for ${prefix}`);
        return res.text();
      });
      for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(m[1]));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
    } while (token);
    return keys;
  }
  try {
    const names = await fs.readdir(path.join(localRoot(), prefix));
    return names.map((n) => `${prefix}${n}`);
  } catch {
    return [];
  }
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export async function deleteObject(key: string): Promise<void> {
  assertDurable();
  const store = r2();
  if (store) {
    await withRetry(async () => {
      const res = await r2Fetch(store, objectUrl(store.base, key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status}) for ${key}`);
    });
    return;
  }
  await fs.rm(path.join(localRoot(), key), { force: true });
}
