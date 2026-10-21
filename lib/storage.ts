import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { del, list, put } from "@vercel/blob";

/**
 * Tiny key/value store for parsed books and generated audio.
 *  - With BLOB_READ_WRITE_TOKEN set (Vercel Blob), objects live in Blob storage.
 *  - Otherwise they are written to ./.cache (or /tmp on Vercel), which is fine
 *    for local development.
 * Keys are always hex-hash based, never user-supplied paths.
 */
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const localRoot = () =>
  process.env.VERCEL ? "/tmp/audiobook-cache" : path.join(process.cwd(), ".cache");

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

export async function getObject(key: string): Promise<Buffer | null> {
  if (useBlob()) {
    const { blobs } = await list({ prefix: key, limit: 5 });
    const hit = blobs.find((b) => b.pathname === key);
    if (!hit) return null;
    const res = await fetch(hit.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
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
