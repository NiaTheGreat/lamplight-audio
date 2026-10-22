import { markNarrated } from "./library";
import { getObject, hasObject, putObject } from "./storage";
import { audioKey, defaultVoice, synthesizeChapter } from "./tts";
import type { Book } from "./types";

/**
 * Background narration of a whole book. A job is a small record in storage; a
 * worker (see app/api/worker) narrates as many chapters as fit in one function
 * run, saves its place, and hands over to a fresh run. Everything is cached
 * chunk by chunk, so a crashed or timed-out run loses almost nothing.
 */
export type Job = {
  status: "running" | "done" | "cancelled" | "error";
  /** Next chapter index to narrate. */
  chapter: number;
  total: number;
  /** The chapters this job covers, inclusive. Older jobs without these cover the whole book. */
  from?: number;
  to?: number;
  startedAt: number;
  updatedAt: number;
  /** Another worker is running until this time; others must not start. */
  leaseUntil: number;
  error?: string;
};

const jobKey = (bookId: string) => `jobs/${bookId}.json`;

export async function getJob(bookId: string): Promise<Job | null> {
  const raw = await getObject(jobKey(bookId));
  return raw ? (JSON.parse(raw.toString("utf8")) as Job) : null;
}

async function saveJob(bookId: string, job: Job): Promise<void> {
  job.updatedAt = Date.now();
  await putObject(jobKey(bookId), JSON.stringify(job), "application/json");
}

/** Keep a requested range inside the book, with from <= to. Missing ends mean the first/last chapter. */
export function clampRange(total: number, from?: unknown, to?: unknown): { from: number; to: number } {
  const last = Math.max(0, total - 1);
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(last, Math.max(0, Math.floor(v))) : fallback;
  const a = num(from, 0);
  const b = num(to, last);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Start (or restart) a job over a range of chapters. Chapters already narrated are skipped quickly. */
export async function startJob(
  bookId: string,
  total: number,
  range?: { from?: unknown; to?: unknown },
): Promise<Job> {
  const now = Date.now();
  const { from, to } = clampRange(total, range?.from, range?.to);
  const job: Job = {
    status: "running",
    chapter: from,
    from,
    to,
    total,
    startedAt: now,
    updatedAt: now,
    leaseUntil: 0,
  };
  await saveJob(bookId, job);
  return job;
}

export async function cancelJob(bookId: string): Promise<void> {
  const job = await getJob(bookId);
  if (job && job.status === "running") {
    job.status = "cancelled";
    await saveJob(bookId, job);
  }
}

export type RunResult = { finished: boolean; skipped?: boolean; error?: string };

/**
 * Narrate chapters until the job is done or the time budget runs out.
 * `reserveMs` is kept free at the end so a chunk already in flight can finish.
 */
export async function runJob(
  bookId: string,
  opts: { budgetMs: number; reserveMs?: number },
): Promise<RunResult> {
  const reserve = opts.reserveMs ?? 40_000;
  const deadline = Date.now() + opts.budgetMs;

  let job = await getJob(bookId);
  if (!job || job.status !== "running") return { finished: true };
  if (job.leaseUntil > Date.now()) return { finished: false, skipped: true };

  const raw = await getObject(`books/${bookId}.json`);
  if (!raw) {
    job.status = "error";
    job.error = "The book is no longer stored. Upload it again.";
    await saveJob(bookId, job);
    return { finished: true, error: job.error };
  }
  const book = JSON.parse(raw.toString("utf8")) as Book;

  job.leaseUntil = deadline + 30_000;
  await saveJob(bookId, job);

  try {
    const last = Math.min(job.to ?? book.chapters.length - 1, book.chapters.length - 1);
    while (job.chapter <= last) {
      // Stop if the user cancelled while we were working.
      const fresh = await getJob(bookId);
      if (!fresh || fresh.status !== "running") return { finished: true };
      job = { ...fresh, leaseUntil: job.leaseUntil };

      const ch = book.chapters[job.chapter];
      const voice = book.voice ?? defaultVoice();
      const key = audioKey(ch.text, voice);

      if (!(await hasObject(key))) {
        const chunkBudget = deadline - Date.now() - reserve;
        if (chunkBudget <= 0) break;
        const result = await synthesizeChapter(ch.text, chunkBudget, voice);
        if (!result.done) break;
        await putObject(key, result.audio, "audio/mpeg");
      }
      await markNarrated(bookId, ch.index);
      job.chapter += 1;
      await saveJob(bookId, job);
    }

    const finished = job.chapter > last;
    if (finished) job.status = "done";
    job.leaseUntil = 0;
    await saveJob(bookId, job);
    return { finished };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Narration failed.";
    job.status = "error";
    job.error = message;
    job.leaseUntil = 0;
    await saveJob(bookId, job);
    return { finished: true, error: message };
  }
}
