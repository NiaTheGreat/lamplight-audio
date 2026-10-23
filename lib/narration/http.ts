/**
 * Serve a buffer with HTTP Range support. iOS Safari refuses to play (or seek)
 * audio from servers that ignore Range requests, so this matters.
 */
export function serveBytes(
  req: Request,
  data: Buffer,
  contentType: string,
  download?: { filename: string },
): Response {
  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  if (download) {
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
    );
  }

  const total = data.length;
  const match = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("range") ?? "").trim());

  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1] === "") {
      // Suffix range: last N bytes.
      start = Math.max(total - Number(match[2]), 0);
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? total - 1 : Math.min(Number(match[2]), total - 1);
    }
    if (start > end || start >= total) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers,
    });
  }

  headers.set("Content-Length", String(total));
  return new Response(new Uint8Array(data), { status: 200, headers });
}
