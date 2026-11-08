import { inspectMp3 } from "../narration/mp3";
import { splitForTts } from "../narration/text";
import { audioKey } from "../narration/tts";
import { getObject, hasObject, putObject } from "../storage/storage";
import type { Para, ReaderBook } from "./types";

/**
 * Everything the reader keeps in storage. All of it can be thrown away (and the EPUB is the only
 * thing that cannot be rebuilt): `epubs/<id>.epub` the original upload, `reader/<id>.json` the
 * formatted chapters made from it, `timing/<id>.json` measured chunk lengths.
 */
const epubKey = (id: string) => `epubs/${id}.epub`;
const readerKey = (id: string) => `reader/${id}.json`;
const timingKey = (id: string) => `timing/${id}.json`;

export async function saveReaderBook(id: string, epub: Buffer, chapters: Para[][]) {
  await putObject(epubKey(id), epub, "application/epub+zip");
  const data: ReaderBook = { v: 1, chapters };
  await putObject(readerKey(id), JSON.stringify(data), "application/json");
  recent.delete(id);
}

export const hasReaderBook = (id: string) => hasObject(readerKey(id));
export const getEpub = (id: string) => getObject(epubKey(id));

// A reader asks for chapter after chapter of the same book; keep the parsed file briefly.
const recent = new Map<string, { at: number; data: ReaderBook | null }>();
const RECENT_MS = 30_000;

export async function getReaderBook(id: string): Promise<ReaderBook | null> {
  const hit = recent.get(id);
  if (hit && Date.now() - hit.at < RECENT_MS) return hit.data;
  let data: ReaderBook | null = null;
  try {
    const raw = await getObject(readerKey(id));
    if (raw) {
      const parsed = JSON.parse(raw.toString("utf8")) as ReaderBook;
      if (parsed.v === 1 && Array.isArray(parsed.chapters)) data = parsed;
    }
  } catch {
    data = null;
  }
  if (recent.size > 3) recent.clear();
  recent.set(id, { at: Date.now(), data });
  return data;
}

type TimingFile = Record<string, { key: string; durations: number[] }>;

async function readTiming(id: string): Promise<TimingFile> {
  try {
    const raw = await getObject(timingKey(id));
    return raw ? (JSON.parse(raw.toString("utf8")) as TimingFile) : {};
  } catch {
    return {};
  }
}

/**
 * How long each narrated chunk of a chapter is, in order. Measured from the cached chunk files
 * the first time, then remembered. The record names the chapter's audio key, so a chapter that was
 * re-read or re-narrated (a new key) is measured again; nothing has to clear it. Null if any chunk
 * is missing (the chapter is not narrated).
 */
export async function chunkDurations(
  bookId: string,
  chapter: number,
  spoken: string,
  voice: string,
): Promise<number[] | null> {
  const key = audioKey(spoken, voice);
  const file = await readTiming(bookId);
  const saved = file[chapter];
  if (saved && saved.key === key) return saved.durations;

  const chunks = splitForTts(spoken);
  const durations: number[] = [];
  for (let i = 0; i < chunks.length; i += 4) {
    const part = await Promise.all(
      chunks.slice(i, i + 4).map(async (c) => {
        const audio = await getObject(audioKey(c, voice));
        return audio ? inspectMp3(audio).seconds : null;
      }),
    );
    for (const d of part) {
      if (d === null || !(d > 0)) return null;
      durations.push(d);
    }
  }
  try {
    file[chapter] = { key, durations };
    await putObject(timingKey(bookId), JSON.stringify(file), "application/json");
  } catch {
    /* only a cache */
  }
  return durations;
}
