// Talking to the server about narrating one chapter. No React in here.

type Progress = { ready: number; total: number };
type OnProgress = (ready: number, total: number) => void;

/**
 * Ask the server to narrate a chapter in this request. Long chapters come back 202 with
 * progress; each retry resumes where the last one stopped. Resolves true when the chapter
 * is ready, false if `cancelled()` became true first.
 */
export async function narrateDirect(
  bookId: string,
  index: number,
  onProgress?: OnProgress,
  cancelled: () => boolean = () => false,
): Promise<boolean> {
  // The generate request is silent until it finishes, so ask separately
  // how many chunks are cached so far.
  const timer = onProgress
    ? setInterval(async () => {
        try {
          const r = await fetch(`/api/audio/${bookId}/${index}?progress=1`);
          if (r.ok && !cancelled()) {
            const p = (await r.json()) as Progress;
            onProgress(p.ready, p.total);
          }
        } catch {
          /* progress is best-effort */
        }
      }, 2000)
    : undefined;
  try {
    for (;;) {
      const res = await fetch(`/api/audio/${bookId}/${index}?prepare=1`);
      if (cancelled()) return false;
      if (res.status === 202) {
        const p = (await res.json()) as Progress;
        onProgress?.(p.ready, p.total);
        continue;
      }
      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      return true;
    }
  } finally {
    clearInterval(timer);
  }
}

/**
 * Narrate a chapter through the background job system, then wait for it: the server does the
 * work whether or not this tab stays open, and it shows in the Queue. If a job is already
 * running for the book (or the job can't be started), narrate directly as before.
 */
export async function narrateViaQueue(
  bookId: string,
  index: number,
  onProgress: OnProgress,
  cancelled: () => boolean,
): Promise<boolean> {
  let started = false;
  try {
    const res = await fetch(`/api/books/${bookId}/narrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapters: [index], onlyIfIdle: true }),
    });
    started = res.ok;
  } catch {
    /* narrate directly instead */
  }
  if (!started) return narrateDirect(bookId, index, onProgress, cancelled);

  let lastJobCheck = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if (cancelled()) {
      // They moved on: stop the work we started, so it doesn't keep spending.
      void fetch(`/api/books/${bookId}/narrate`, { method: "DELETE" }).catch(() => {});
      return false;
    }
    try {
      const r = await fetch(`/api/audio/${bookId}/${index}?progress=1`);
      if (r.ok) {
        const p = (await r.json()) as Progress;
        onProgress(p.ready, p.total);
        if (p.total > 0 && p.ready >= p.total) return true;
      }
      // Every few seconds, check the job itself so a failure shows up instead of waiting forever.
      if (Date.now() - lastJobCheck > 6000) {
        lastJobCheck = Date.now();
        const j = await fetch(`/api/books/${bookId}/narrate`)
          .then((x) => (x.ok ? x.json() : null))
          .catch(() => null);
        if (j && j.status === "error") throw new Error(j.error ?? "Narration failed.");
        if (j && j.status === "cancelled") return false;
      }
    } catch (err) {
      if (err instanceof Error && err.message && !/fetch|network/i.test(err.message)) throw err;
      /* a dropped request: look again next time round */
    }
  }
}
