/**
 * The browser's side of the server's JSON API. One typed function per endpoint, so screens
 * don't each build URLs, headers and error messages by hand.
 *
 * Failures: a response that isn't ok throws an `ApiError` whose message is the server's own
 * `error` text when it sent one, otherwise the function's fallback. A dropped connection
 * rejects with the browser's own error. Functions marked "soft" never throw.
 *
 * Type-only imports from server files are fine here: they are erased at build time.
 */
import type { SpeedStats } from "../eta";
import type { LiveItem, QueueItem } from "../narration/narration";
import type { Pron } from "../pronunciation/pronunciation";
import type { StaleChapter } from "../pronunciation/pronunciation-store";
import type { PronLists } from "../pronunciation/pronlists";
import type { NarratorGroupInfo } from "@/components/useNarrators";
import type { Progress } from "@/components/player/types";
import type { Settings } from "../settings-shared";
import type { BookSummary } from "../types";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Init = { method?: "GET" | "PUT" | "POST" | "PATCH" | "DELETE"; body?: unknown; noStore?: boolean };

/** Send a request, expect JSON back, and turn a failure into an `ApiError`. */
async function call<T>(url: string, init: Init, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    ...(init.body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
    ...(init.noStore ? { cache: "no-store" as const } : {}),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new ApiError(data?.error ?? fallback, res.status);
  return data as T;
}

/** Like `call`, but a failure of any kind gives `null`. */
async function soft<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

// ---------- Pronunciation ----------

export type BookPronunciation = {
  lines: Pron[];
  list: { id: string; name: string; lines: Pron[] } | null;
  stale: StaleChapter[];
};

export const pronunciationListsOrEmpty = async (): Promise<PronLists> =>
  (await soft<PronLists>("/api/pronunciation-lists")) ?? { lists: [] };
export const getPronunciationLists = () => call<PronLists>("/api/pronunciation-lists", {}, "Couldn't load your lists.");
export const savePronunciationLists = (data: PronLists) =>
  call<PronLists>("/api/pronunciation-lists", { method: "PUT", body: data }, "Couldn't save.");

export const getBookPronunciation = (bookId: string) =>
  call<BookPronunciation>(`/api/books/${bookId}/pronunciation`, {}, "Couldn't load the list.");
export const changeBookPronunciation = (bookId: string, method: "PUT" | "POST", body: unknown) =>
  call<BookPronunciation>(`/api/books/${bookId}/pronunciation`, { method, body }, "That didn't work.");

// ---------- Narration ----------

export type QueueState = { items: QueueItem[]; live: LiveItem[]; speed: SpeedStats };
export const getQueue = () => call<QueueState>("/api/queue", { noStore: true }, "Couldn't load the queue.");

export type JobAction = "pause" | "resume" | "cancel";
/** Pause, resume or cancel a book's background narration job. */
export const jobAction = (bookId: string, action: JobAction) =>
  call<unknown>(`/api/books/${bookId}/narrate`, { method: "PATCH", body: { action } }, `Couldn't ${action} narration.`);

export const changeNarrator = (bookId: string, narrator: string) =>
  call<unknown>(`/api/books/${bookId}/narrator`, { method: "PUT", body: { narrator } }, "Couldn't change the narrator.");

/** Rebuild one narrated chapter's MP3 from its saved pieces. Resolves to the number rebuilt, or null on any failure. */
export async function repairChapter(bookId: string, chapter: number): Promise<number | null> {
  try {
    const data = await call<{ rebuilt?: number }>(`/api/books/${bookId}/repair`, { method: "POST", body: { chapter } }, "Couldn't repair that chapter.");
    return data.rebuilt ?? 0;
  } catch {
    return null;
  }
}

// ---------- Books, progress and settings (soft) ----------

export const getBook = (id: string) => soft<BookSummary>(`/api/books/${id}`);
export const getProgress = () => soft<Progress>("/api/progress");
export const getSettings = () => soft<Settings>("/api/settings");
/** Save settings; resolves to what the server kept, or null if it couldn't be reached. */
export async function saveSettings(settings: Settings): Promise<Settings | null> {
  try {
    return await call<Settings>("/api/settings", { method: "PUT", body: settings }, "Couldn't save settings.");
  } catch {
    return null;
  }
}

// ---------- Reference data (soft) ----------

export const getSpeed = async (): Promise<SpeedStats> => (await soft<SpeedStats>("/api/speed")) ?? {};
export const getUsage = () => soft<{ chars: number; usd: number; limitUsd: number }>("/api/usage");
export const getNarrators = () => soft<NarratorGroupInfo[]>("/api/narrators");
