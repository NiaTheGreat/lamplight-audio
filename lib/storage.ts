import { promises as fs } from "node:fs";
import path from "node:path";
import { list, put } from "@vercel/blob";

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
  await fs.writeFile(file, data);
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
