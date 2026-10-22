/**
 * Narrators: who reads the book aloud. A narrator id is a string.
 *  - A plain voice name ("ballad") is the original OpenAI narrator. Books, settings and
 *    cached audio made before narrators existed all use these, and they must keep
 *    resolving exactly as they always have.
 *  - "provider:model:voice" (for example "deepinfra:kokoro:af_bella") is anything else.
 *
 * This file is safe for the browser: it holds names and prices only, never keys.
 */

/** OpenAI speech voices (the original narrators). */
export const VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
] as const;

/**
 * Kokoro-82M voices (American "a" and British "b", female "f" and male "m"). From the
 * Kokoro v1.0 model; if DeepInfra rejects one, narration reports the provider's error.
 */
export const KOKORO_VOICES = [
  "af_heart",
  "af_bella",
  "af_nicole",
  "af_sarah",
  "af_sky",
  "af_aoede",
  "af_kore",
  "af_nova",
  "af_river",
  "af_alloy",
  "af_jessica",
  "am_adam",
  "am_michael",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_onyx",
  "am_puck",
  "bf_emma",
  "bf_isabella",
  "bf_alice",
  "bf_lily",
  "bm_george",
  "bm_lewis",
  "bm_daniel",
  "bm_fable",
] as const;

export type Provider = "openai" | "deepinfra";

export type ParsedNarrator = {
  provider: Provider;
  /** "kokoro" for DeepInfra; undefined for OpenAI (the model comes from OPENAI_TTS_MODEL). */
  model?: string;
  voice: string;
};

/** Estimated USD per million characters. OpenAI is an estimate (gpt-4o-mini-tts bills by token). */
export const PRICE_PER_MILLION_CHARS: Record<Provider, number> = {
  openai: 16,
  deepinfra: 0.99,
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  deepinfra: "Kokoro (DeepInfra)",
};

/** Environment variable that must be set for a provider to work. */
export const PROVIDER_KEY_ENV: Record<Provider, string> = {
  openai: "OPENAI_API_KEY",
  deepinfra: "DEEPINFRA_API_KEY",
};

export const kokoroId = (voice: string) => `deepinfra:kokoro:${voice}`;

/** Understand a narrator id, or null if it isn't one we know how to run. */
export function parseNarrator(id: unknown): ParsedNarrator | null {
  if (typeof id !== "string" || !id) return null;
  if (!id.includes(":")) return { provider: "openai", voice: id }; // legacy plain voice
  const [provider, model, voice, ...rest] = id.split(":");
  if (rest.length || !voice) return null;
  if (provider === "deepinfra" && model === "kokoro") return { provider: "deepinfra", model, voice };
  return null;
}

/** Only narrators offered in the UI. Anything else becomes undefined. */
export function sanitizeNarrator(id: unknown): string | undefined {
  const parsed = parseNarrator(id);
  if (!parsed || typeof id !== "string") return undefined;
  if (parsed.provider === "openai") return (VOICES as readonly string[]).includes(id) ? id : undefined;
  return (KOKORO_VOICES as readonly string[]).includes(parsed.voice) ? id : undefined;
}

export function providerOf(id: string | undefined): Provider {
  return parseNarrator(id)?.provider ?? "openai";
}

export function pricePerMillion(id: string | undefined): number {
  return PRICE_PER_MILLION_CHARS[providerOf(id)];
}

/** Estimated dollars to narrate `chars` characters with this narrator. */
export function costUsd(chars: number, id: string | undefined): number {
  return (chars * pricePerMillion(id)) / 1_000_000;
}

export const formatUsd = (usd: number) => `$${usd.toFixed(2)}`;

const prettyVoice = (voice: string) => {
  const name = voice.includes("_") ? voice.split("_")[1] : voice;
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** "Ballad" for an OpenAI voice, "Bella (Kokoro)" for the others. */
export function narratorLabel(id: string | undefined): string {
  const parsed = parseNarrator(id);
  if (!parsed) return id ?? "";
  return parsed.provider === "openai" ? prettyVoice(parsed.voice) : `${prettyVoice(parsed.voice)} (Kokoro)`;
}

export type NarratorGroup = {
  provider: Provider;
  label: string;
  pricePerMillion: number;
  narrators: { id: string; label: string }[];
};

/** Every narrator the UI offers, grouped by provider. */
export const NARRATOR_GROUPS: NarratorGroup[] = [
  {
    provider: "openai",
    label: PROVIDER_LABEL.openai,
    pricePerMillion: PRICE_PER_MILLION_CHARS.openai,
    narrators: VOICES.map((v) => ({ id: v, label: prettyVoice(v) })),
  },
  {
    provider: "deepinfra",
    label: PROVIDER_LABEL.deepinfra,
    pricePerMillion: PRICE_PER_MILLION_CHARS.deepinfra,
    narrators: KOKORO_VOICES.map((v) => ({ id: kokoroId(v), label: prettyVoice(v) })),
  },
];
