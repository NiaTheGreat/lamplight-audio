// One-off: copy everything from the old Vercel Blob store into the R2 bucket, keeping the same key names
// (so already-narrated audio keeps working). Safe to re-run: objects already in R2 are skipped.
//
//   npm i --no-save @vercel/blob
//   BLOB_READ_WRITE_TOKEN=... R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=... \
//     node scripts/migrate-blob-to-r2.mjs
//
// Listing counts as Blob "advanced" operations, so this only works while the store is not over its limit.
import { list } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

const need = ["BLOB_READ_WRITE_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
for (const n of need) if (!process.env[n]) throw new Error(`Set ${n}`);

const base = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET}`;
const r2 = new AwsClient({
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});
const url = (key) => `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;

// Records that are only meaningful for a running job or a moment in time are not worth copying.
const skip = (key) => key.startsWith("jobs/") || key.startsWith("usage/") || key.startsWith("throttle/");

let cursor;
let copied = 0, skipped = 0, failed = 0, bytes = 0;
do {
  const page = await list({ cursor, limit: 1000 });
  for (const blob of page.blobs) {
    const key = blob.pathname;
    if (skip(key)) { skipped++; continue; }
    try {
      const head = await r2.fetch(url(key), { method: "HEAD" });
      if (head.ok) { skipped++; continue; }
      const src = await fetch(blob.url);
      if (!src.ok) throw new Error(`download ${src.status}`);
      const body = new Uint8Array(await src.arrayBuffer());
      const immutable = key.startsWith("audio/") || key.startsWith("previews/");
      const put = await r2.fetch(url(key), {
        method: "PUT",
        headers: {
          "Content-Type": src.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-store",
        },
        body,
      });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      copied++; bytes += body.length;
      console.log(`copied ${key} (${(body.length / 1e6).toFixed(1)} MB)`);
    } catch (err) {
      failed++;
      console.error(`FAILED ${key}: ${err.message}`);
    }
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

console.log(`\nDone. Copied ${copied} (${(bytes / 1e6).toFixed(0)} MB), skipped ${skipped}, failed ${failed}.`);
if (failed) process.exitCode = 1;
