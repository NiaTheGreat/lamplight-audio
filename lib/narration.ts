import { markNarrated } from "./library";
import { getObject, hasObject, putObject } from "./storage";
import { audioKey, synthesizeChapter } from "./tts";
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

/** Start (or restart) a job. Chapters already narrated are skipped quickly. */
export async function startJob(bookId: string, total: number): Promise<Job> {
  const now = Date.now();
  const job: Job = {
    status: "running",
    chapter: 0,
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
    while (job.chapter < book.chapters.length) {
      // Stop if the user cancelled while we were working.
      const fresh = await getJob(bookId);
      if (!fresh || fresh.status !== "running") return { finished: true };
      job = { ...fresh, leaseUntil: job.leaseUntil };

      const ch = book.chapters[job.chapter];
      const key = audioKey(ch.text);

      if (!(await hasObject(key))) {
        const chunkBudget = deadline - Date.now() - reserve;
        if (chunkBudget <= 0) break;
        const result = await synthesizeChapter(ch.text, chunkBudget);
        if (!result.done) break;
        await putObject(key, result.audio, "audio/mpeg");
      }
      await markNarrated(bookId, ch.index);
      job.chapter += 1;
      await saveJob(bookId, job);
    }

    const finished = job.chapter >= book.chapters.length;
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
