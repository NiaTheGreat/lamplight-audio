import { VOICES, sanitizeNarrator } from "./narrators-shared";

export { VOICES };

/** A narrator id from the offered list (OpenAI voice names and Kokoro ids), or undefined for anything else. */
export const sanitizeVoice = (v: unknown): string | undefined => sanitizeNarrator(v);

export type Settings = {
  /** Narrator id given to newly added fics: a plain OpenAI voice name, or e.g. "deepinfra:kokoro:af_bella". */
  voice: string;
  /** Default playback speed. */
  speed: number;
  /** Default sleep timer: minutes, 0 for off, -1 for end of chapter. */
  sleep: number;
  /** Screen dimming, 0 (none) to 100 (darkest). */
  dim: number;
};

export const DEFAULT_SETTINGS: Settings = { voice: "ballad", speed: 1, sleep: 0, dim: 15 };

export const SPEEDS = [0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const SLEEP_OPTIONS = [0, 15, 30, 60, -1];

/** Clamp anything from the client into a valid Settings object. */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = (input ?? {}) as Partial<Settings>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    voice: sanitizeNarrator(raw.voice) ?? base.voice,
    speed: num(raw.speed, 0.5, 2, base.speed),
    sleep: SLEEP_OPTIONS.includes(raw.sleep as number) ? (raw.sleep as number) : base.sleep,
    dim: Math.round(num(raw.dim, 0, 100, base.dim)),
  };
}

