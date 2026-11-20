/* Lamplight service worker: offline listening.
 *
 * 1. /offline-audio/<book>/<chapter> is a chapter the listener chose to keep on this device. It is
 *    answered from Cache Storage with Range support (iOS Safari needs it to play and seek). If the
 *    copy is gone (the phone cleared it), it falls back to the normal streaming URL.
 * 2. Everything else is network-first with the last good answer as a fallback, so pages the
 *    listener has opened can still open offline. Streaming audio and the narration/worker/queue
 *    calls are never cached here.
 * See docs/offline.md. */
const AUDIO = "lamplight-offline-audio-v1";
const SHELL = "lamplight-shell-v1";
const NETWORK_WAIT_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("lamplight-shell-") && name !== SHELL) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_AUDIO = /^\/offline-audio\/([A-Za-z0-9_-]+)\/(\d{1,4})$/;
const NEVER_CACHE =
  /^\/(api\/(audio|worker|queue|login|usage|speed|uploads|pronounce)|_next\/image)/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const m = OFFLINE_AUDIO.exec(url.pathname);
  if (m) {
    event.respondWith(serveKept(req, url, m[1], m[2]));
    return;
  }
  if (NEVER_CACHE.test(url.pathname) || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function serveKept(req, url, book, chapter) {
  const cache = await caches.open(AUDIO);
  const hit = await cache.match(url.pathname);
  if (!hit) return Response.redirect(`/api/audio/${book}/${chapter}`, 302);
  const data = await hit.arrayBuffer();
  const total = data.byteLength;
  const headers = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get("range") || "").trim());
  if (range && (range[1] || range[2])) {
    let start;
    let end;
    if (range[1] === "") {
      start = Math.max(total - Number(range[2]), 0);
      end = total - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === "" ? total - 1 : Math.min(Number(range[2]), total - 1);
    }
    if (start > end || start >= total) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    }
    return new Response(data.slice(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(data, {
    status: 200,
    headers: { ...headers, "Content-Length": String(total) },
  });
}

async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), NETWORK_WAIT_MS)),
    ]);
    // Only a real answer is kept: not a redirect to the login page, not an error.
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    // A slow connection with nothing kept: wait for the network after all.
    return fetch(req);
  }
}
