import { setKey } from "./keys";
import { listLive } from "./live";
import { voiceFor } from "./chaptervoice";
import { spokenText } from "./pronunciation";
import { markNarrated } from "./library";
import { getObject, hasObject, putObject } from "./storage";
import { recordSpeed, flushSpeed } from "./speed";
import { audioKey, charsSynthesized, synthesizeChapter } from "./tts";
import type { Book, LibraryEntry } from "./types";

/**
 * Background narration of a whole book. A job is a small record in storage; a
 * worker (see app/api/worker) narrates as many chapters as fit in one function
 * run, saves its place, and hands over to a fresh run. Everything is cached
 * chunk by chunk, so a crashed or timed-out run loses almost nothing.
 */
export type Job = {
  status: "running" | "paused" | "done" | "cancelled" | "error";
  /** Next chapter index to narrate. */
  chapter: number;
  total: number;
  /** The chapters this job covers, inclusive. Older jobs without these cover the whole book. */
  from?: number;
  to?: number;
  /** Exactly these chapters (ascending), for a job that isn't one contiguous range, e.g. several chapters re-read. */
  chapters?: number[];
  startedAt: number;
  updatedAt: number;
  /** Another worker is running until this time; others must not start. */
  leaseUntil: number;
  error?: string;
};

/** A running job whose worker hasn't saved progress for this long is treated as dead, not busy. */
export const JOB_STALE_MS = 8 * 60 * 1000;

/** Really being worked on right now (a job left "running" by a crashed worker doesn't count). */
export function isJobActive(job: Job | null | undefined): boolean {
  return job?.status === "running" && Date.now() - job.updatedAt < JOB_STALE_MS;
}

const jobKey = (bookId: string) => `jobs/${bookId}.json`;

export async function getJob(bookId: string): Promise<Job | null> {
  const raw = await getObject(jobKey(bookId));
  return raw ? (JSON.parse(raw.toString("utf8")) as Job) : null;
}

async function saveJob(bookId: string, job: Job): Promise<void> {
  job.updatedAt = Date.now();
  await putObject(jobKey(bookId), JSON.stringify(job), "application/json");
}

/**
 * Which books have a job worth showing in the queue (running, paused or failed), so the
 * queue page reads one small file instead of listing storage.
 */
const INDEX_KEY = "jobs/active.json";

async function readIndex(): Promise<string[]> {
  const raw = await getObject(INDEX_KEY);
  return raw ? (JSON.parse(raw.toString("utf8")) as string[]) : [];
}

async function setQueued(bookId: string, queued: boolean): Promise<void> {
  try {
    const ids = await readIndex();
    if (ids.includes(bookId) === queued) return;
    const next = queued ? [...ids, bookId] : ids.filter((id) => id !== bookId);
    await putObject(INDEX_KEY, JSON.stringify(next), "application/json");
  } catch {
    /* the queue page is a convenience; a missed update fixes itself on the next change */
  }
}

export type QueueItem = {
  id: string;
  title: string;
  author?: string;
  voice?: string;
  job: Job;
  /** Characters still to narrate in this job's range. */
  remainingChars: number;
};

export type LiveItem = { id: string; title: string; author?: string; voice?: string; chapter: number; startedAt: number };

/** Chapters being narrated because someone pressed play. */
export async function listLiveItems(): Promise<LiveItem[]> {
  const out: LiveItem[] = [];
  for (const l of await listLive()) {
    const raw = await getObject(`library/${l.bookId}.json`);
    if (!raw) continue;
    const entry = JSON.parse(raw.toString("utf8")) as LibraryEntry;
    out.push({ id: l.bookId, title: entry.title, author: entry.author, voice: entry.voice, chapter: l.chapter, startedAt: l.startedAt });
  }
  return out;
}

/** Everything in the queue, with what's left of each job. */
export async function listQueue(): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const stale: string[] = [];
  for (const id of await readIndex()) {
    const job = await getJob(id);
    const raw = await getObject(`library/${id}.json`);
    if (!job || !raw || job.status === "done" || job.status === "cancelled") {
      stale.push(id);
      continue;
    }
    const entry = JSON.parse(raw.toString("utf8")) as LibraryEntry;
    const done = new Set(entry.narrated ?? []);
    let remainingChars = 0;
    for (const i of remainingChapters(job, entry.chapterCount)) if (!done.has(i)) remainingChars += entry.chars?.[i] ?? 0;
    items.push({ id, title: entry.title, author: entry.author, voice: entry.voice, job, remainingChars });
  }
  for (const id of stale) await setQueued(id, false);
  return items;
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

/** The chapters a job still has to do, in order (those before its pointer are done). */
export function remainingChapters(job: Pick<Job, "chapter" | "to" | "chapters">, count: number): number[] {
  if (job.chapters) return job.chapters.filter((c) => c >= job.chapter && c < count);
  const out: number[] = [];
  for (let i = Math.max(job.chapter, 0); i <= Math.min(job.to ?? count - 1, count - 1); i++) out.push(i);
  return out;
}

/** Start (or restart) a job over a range of chapters, or over an explicit list of them. Chapters already narrated are skipped quickly. */
export async function startJob(
  bookId: string,
  total: number,
  range?: { from?: unknown; to?: unknown },
  chapters?: unknown,
): Promise<Job> {
  const now = Date.now();
  const list = Array.isArray(chapters)
    ? [...new Set(chapters.filter((c): c is number => Number.isInteger(c) && c >= 0 && c < total))].sort((a, b) => a - b)
    : [];
  const { from, to } = list.length ? { from: list[0], to: list[list.length - 1] } : clampRange(total, range?.from, range?.to);
  const job: Job = {
    status: "running",
    chapter: from,
    from,
    to,
    ...(list.length ? { chapters: list } : {}),
    total,
    startedAt: now,
    updatedAt: now,
    leaseUntil: 0,
  };
  await saveJob(bookId, job);
  await setQueued(bookId, true);
  return job;
}

/** Stop the job for good. Chapters already narrated are kept. */
export async function cancelJob(bookId: string): Promise<void> {
  const job = await getJob(bookId);
  if (job && (job.status === "running" || job.status === "paused" || job.status === "error")) {
    job.status = "cancelled";
    await saveJob(bookId, job);
  }
  await setQueued(bookId, false);
}

/** Hold a running job. The worker notices between chunks, so at most one chunk more is spent. */
export async function pauseJob(bookId: string): Promise<Job | null> {
  const job = await getJob(bookId);
  if (job && job.status === "running") {
    job.status = "paused";
    await saveJob(bookId, job);
  }
  return job;
}

/** Continue a paused (or failed) job from where it stopped. The caller then kicks the worker. */
export async function resumeJob(bookId: string): Promise<Job | null> {
  const job = await getJob(bookId);
  if (job && (job.status === "paused" || job.status === "error")) {
    job.status = "running";
    delete job.error;
    await saveJob(bookId, job);
    await setQueued(bookId, true);
  }
  return job;
}

/**
 * Called when a worker leaves: hand back the lease and, if the user paused or cancelled meanwhile,
 * keep that status instead of overwriting it with this worker's stale copy.
 */
async function leave(bookId: string, mine: Job, finished: boolean): Promise<Job> {
  const fresh = (await getJob(bookId)) ?? mine;
  fresh.chapter = Math.max(fresh.chapter, mine.chapter);
  if (fresh.status === "running" && finished) fresh.status = "done";
  fresh.leaseUntil = 0;
  await saveJob(bookId, fresh);
  if (fresh.status === "done") await setQueued(bookId, false);
  return fresh;
}

export type RunResult = { finished: boolean; skipped?: boolean; error?: string };

/**
 * Narrate chapters until the job is done or the time budget runs out.
 * `reserveMs` is kept free at the end so a chunk already in flight can finish.
 */
export async function runJob(
  bookId: string,
  opts: { budgetMs: number; reserveMs?: number; stopCheckMs?: number },
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

  // Looked at between chunks, at most every few seconds, so a pause or cancel takes hold quickly
  // without a storage read per chunk.
  let checkedAt = 0;
  const shouldStop = async () => {
    if (Date.now() - checkedAt < (opts.stopCheckMs ?? 8_000)) return false;
    checkedAt = Date.now();
    const now = await getJob(bookId);
    return !now || now.status !== "running";
  };

  try {
    for (;;) {
      const next = remainingChapters(job, book.chapters.length)[0];
      if (next === undefined) break;
      job.chapter = next; // skips the gaps in a job that covers a list of chapters
      const ch = book.chapters[job.chapter];
      const voice = voiceFor(book, ch.index);
      const spoken = spokenText(book, ch.index, ch.text);
      const key = audioKey(spoken, voice);

      if (!(await hasObject(key))) {
        const chunkBudget = deadline - Date.now() - reserve;
        if (chunkBudget <= 0) break;
        const startedMs = Date.now();
        const charsBefore = charsSynthesized();
        const result = await synthesizeChapter(spoken, chunkBudget, voice, shouldStop);
        recordSpeed(voice, charsSynthesized() - charsBefore, Date.now() - startedMs);
        if (!result.done) break;
        await putObject(key, result.audio, "audio/mpeg");
      }
      await markNarrated(bookId, ch.index);
      await setKey(bookId, ch.index, key);
      // Look again before saving: a pause or cancel that arrived while this chapter was being
      // narrated must not be overwritten with our older copy.
      const fresh = await getJob(bookId);
      if (!fresh || fresh.status !== "running") {
        job.chapter += 1;
        await leave(bookId, job, false);
        return { finished: true };
      }
      job = { ...fresh, chapter: job.chapter + 1, leaseUntil: job.leaseUntil };
      await saveJob(bookId, job);
    }

    const after = await leave(bookId, job, remainingChapters(job, book.chapters.length).length === 0);
    await flushSpeed();
    return { finished: after.status !== "running" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Narration failed.";
    const current = (await getJob(bookId)) ?? job;
    if (current.status === "running") {
      current.status = "error";
      current.error = message;
    }
    current.leaseUntil = 0;
    await saveJob(bookId, current);
    await flushSpeed();
    return { finished: true, error: message };
  }
}
