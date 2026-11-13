/**
 * Upload one EPUB to the library from the browser. Small files go in the request; files over about
 * 4 MB (Vercel's body limit) go straight to storage first, then the server reads them from there.
 */
const DIRECT_LIMIT = 4_000_000;

export type UploadResult = { ok: true; title: string } | { ok: false; error: string };

function describeFailure(status: number, serverMessage: string | undefined, file: File): string {
  if (serverMessage) return serverMessage;
  const mb = (file.size / 1_000_000).toFixed(1);
  if (status === 413) return `That file is ${mb} MB, which is too big for the server to accept.`;
  if (status === 401) return "You've been signed out. Reload the page and log in again.";
  if (status === 504 || status === 408) return "The upload took too long and timed out.";
  return `Upload failed (${status}). The file was ${mb} MB.`;
}

async function viaStorage(file: File, browse: boolean): Promise<Response | null> {
  const ask = await fetch("/api/uploads", { method: "POST" });
  const slot = (await ask.json().catch(() => null)) as {
    direct?: boolean;
    key?: string;
    url?: string;
  } | null;
  if (!ask.ok || !slot) throw new Error("Couldn't start the upload.");
  if (slot.direct || !slot.key || !slot.url) return null; // no bucket: use the normal path
  let put: Response;
  try {
    put = await fetch(slot.url, { method: "PUT", body: file });
  } catch {
    throw new Error(
      "Couldn't upload to storage (the bucket's CORS setting may not allow this site).",
    );
  }
  if (!put.ok) throw new Error(`Storage refused the upload (${put.status}).`);
  return fetch("/api/books", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadKey: slot.key, skipNotes: true, browse }),
  });
}

export async function uploadEpub(file: File, opts: { browse: boolean }): Promise<UploadResult> {
  if (!/\.epub$/i.test(file.name) && file.type !== "application/epub+zip") {
    return { ok: false, error: "That doesn't look like an EPUB." };
  }
  try {
    let res: Response | null = null;
    if (file.size > DIRECT_LIMIT) res = await viaStorage(file, opts.browse);
    if (!res) {
      const form = new FormData();
      form.append("file", file);
      form.append("skipNotes", "true");
      form.append("browse", String(opts.browse));
      res = await fetch("/api/books", { method: "POST", body: form });
    }
    const text = await res.text();
    let data: { title?: string; error?: string } | null = null;
    try {
      data = JSON.parse(text) as { title?: string; error?: string };
    } catch {
      /* not JSON: described below */
    }
    if (!res.ok || !data?.title) {
      return { ok: false, error: describeFailure(res.status, data?.error, file) };
    }
    return { ok: true, title: data.title };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The upload failed." };
  }
}
