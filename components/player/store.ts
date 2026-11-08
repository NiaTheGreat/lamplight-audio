// Device-local settings (localStorage) and the constants the player shares.

export const CPM_KEY = "abg:cpm";
export const AUTONEXT_KEY = "abg:autonext";
export const CONFIRM_KEY = "abg:confirm";
export const RANGE_KEY = "abg:range";
export const POSITION_KEY = "abg:last";
export const DIM_LEVELS = [0, 25, 50, 80];

// A silent clip played on the first tap so iOS lets us start audio later,
// after the (possibly slow) first-time narration finishes.
export const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; fine */
  }
}
