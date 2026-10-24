import { NextResponse } from "next/server";
import { getUploadUrl } from "@/lib/storage/storage";
import { newUploadKey } from "@/lib/storage/uploads";

export const runtime = "nodejs";

/**
 * Ask where to upload a large EPUB. Returns a short-lived signed address in the
 * bucket, or `{ direct: true }` when there is no bucket (local development)
 * and the file should simply be posted to /api/books.
 */
export async function POST() {
  const key = newUploadKey();
  const url = await getUploadUrl(key);
  if (!url) return NextResponse.json({ direct: true });
  return NextResponse.json({ key, url });
}
