import { getObject, putObject } from "./storage";

/**
 * Where each narrated chapter's audio lives, per book: `{ "0": "audio/<hash>.mp3", ... }`.
 * A chapter's audio is named by a hash of its text and voice, which normally means reading the
 * whole book just to find it. This small file lets playing a narrated chapter skip that.
 * Entries are only for narrated chapters, whose voice and wording are pinned, so they don't go
 * stale; re-reading a chapter clears its entry.
 */
const file = (bookId: string) => `keys/${bookId}.json`;

export async function getKeys(bookId: string): Promise<Record<string, string>> {
  try {
    const raw = await getObject(file(bookId));
    return raw ? (JSON.parse(raw.toString("utf8")) as Record<string, string>) : {};
  } catch {
    return {}; // fall back to working it out from the book
  }
}

export async function setKey(bookId: string, index: number, key: string): Promise<void> {
  try {
    const keys = await getKeys(bookId);
    if (keys[index] === key) return;
    keys[index] = key;
    await putObject(file(bookId), JSON.stringify(keys), "application/json");
  } catch {
    /* an optimisation only */
  }
}

export async function clearKeys(bookId: string, indices: number[]): Promise<void> {
  try {
    const keys = await getKeys(bookId);
    let changed = false;
    for (const i of indices) {
      if (keys[i] !== undefined) {
        delete keys[i];
        changed = true;
      }
    }
    if (changed) await putObject(file(bookId), JSON.stringify(keys), "application/json");
  } catch {
    /* an optimisation only */
  }
}
