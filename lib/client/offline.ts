"use client";

import { useSyncExternalStore } from "react";

/**
 * Chapters kept on this device for listening without a connection. The MP3 lives in Cache Storage
 * (served by `public/sw.js` at `/offline-audio/<book>/<chapter>`); a small list in localStorage says
 * which ones, so the player can pick the right address without waiting on an async lookup.
 * Nothing here can break normal playback: every call falls back to streaming. See docs/offline.md.
 */

export const OFFLINE_CACHE = "lamplight-offline-audio-v1";
const LIST_KEY = "lamplight:offline";

const listeners = new Set<() => void>();
let snapshot: string | null = null;

function readList(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeList(list: string[]): void {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    /* private mode: the copy still plays, it just isn't remembered after a reload */
  }
  snapshot = null;
  listeners.forEach((l) => l());
}

const id = (bookId: string, chapter: number) => `${bookId}:${chapter}`;
const kept = (bookId: string, chapter: number) => `/offline-audio/${bookId}/${chapter}`;

export function isKept(bookId: string, chapter: number): boolean {
  return readList().includes(id(bookId, chapter));
}

/** The address to give the audio element: the kept copy if there is one, else the stream. */
export function audioSrc(bookId: string, chapter: number): string {
  return isKept(bookId, chapter) ? kept(bookId, chapter) : `/api/audio/${bookId}/${chapter}`;
}

export function offlineSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window && "serviceWorker" in navigator;
}

/** Fetch a narrated chapter and keep it. Returns an error message, or null. */
export async function keepChapter(bookId: string, chapter: number): Promise<string | null> {
  if (!offlineSupported()) return "This browser can't keep audio for offline listening.";
  try {
    // Same-origin on purpose: the plain audio address redirects to the bucket, which a fetch from
    // the page can't read without extra CORS rules.
    const res = await fetch(`/api/audio/${bookId}/${chapter}?download=1`);
    if (!res.ok)
      return res.status === 404 ? "That chapter isn't narrated yet." : "Couldn't download it.";
    const body = await res.arrayBuffer();
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.put(
      kept(bookId, chapter),
      new Response(body, { headers: { "Content-Type": "audio/mpeg" } }),
    );
    const list = readList();
    if (!list.includes(id(bookId, chapter))) writeList([...list, id(bookId, chapter)]);
    // Ask the browser not to clear it when space runs low. It may say no; that's fine.
    void navigator.storage?.persist?.().catch(() => {});
    return null;
  } catch (err) {
    const quota = err instanceof DOMException && err.name === "QuotaExceededError";
    return quota ? "Not enough space on this device." : "Couldn't download it.";
  }
}

export async function removeChapter(bookId: string, chapter: number): Promise<void> {
  writeList(readList().filter((x) => x !== id(bookId, chapter)));
  try {
    await (await caches.open(OFFLINE_CACHE)).delete(kept(bookId, chapter));
  } catch {
    /* nothing kept */
  }
}

/** Drop copies of chapters whose narration was thrown away (re-read), so the old audio never plays. */
export async function removeChapters(bookId: string, chapters: number[]): Promise<void> {
  for (const c of chapters) await removeChapter(bookId, c);
}

export async function removeBook(bookId: string): Promise<void> {
  const mine = readList().filter((x) => x.startsWith(`${bookId}:`));
  await removeChapters(
    bookId,
    mine.map((x) => Number(x.split(":")[1])),
  );
}

export async function removeAll(): Promise<void> {
  writeList([]);
  try {
    await caches.delete(OFFLINE_CACHE);
  } catch {
    /* nothing kept */
  }
}

/** How much this site is using on the device, in bytes, if the browser says. */
export async function storageUsed(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage ?? null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): string {
  if (snapshot === null) snapshot = JSON.stringify(readList());
  return snapshot;
}

/** Which chapters of a book are kept (React state that updates when one is added or removed). */
export function useKept(bookId: string | undefined): Set<number> {
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  const out = new Set<number>();
  if (!bookId) return out;
  for (const entry of JSON.parse(raw) as string[]) {
    const [b, c] = entry.split(":");
    if (b === bookId) out.add(Number(c));
  }
  return out;
}

export function useKeptCount(): number {
  return (JSON.parse(useSyncExternalStore(subscribe, getSnapshot, () => "[]")) as string[]).length;
}

export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {});
}
