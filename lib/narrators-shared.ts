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

/**
 * ElevenLabs premade female voices (name -> voice id). Ids are from ElevenLabs' premade
 * library; if one is rejected, narration reports the provider's error.
 */
export const ELEVENLABS_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", traits: "American, calm" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", traits: "American, soft" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", traits: "American, warm" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", traits: "American, young" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", traits: "American, strong" },
  { id: "ThT5KcBeYPX3keUQqHPh", name: "Dorothy", traits: "British, pleasant" },
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", traits: "English-Swedish, seductive" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", traits: "British, confident" },
] as const;

/**
 * Everything about a provider that the browser may see (no keys, no request code; that
 * lives in lib/providers). A new provider starts as one row here.
 */
export const PROVIDER_INFO = {
  openai: {
    /** Name used in error messages. */
    name: "OpenAI",
    label: "OpenAI",
    keyEnv: "OPENAI_API_KEY",
    // Estimate: gpt-4o-mini-tts bills by token.
    pricePerMillion: 16,
    // Narrated speech is never smaller than this per character; smaller is an empty or cut-off file.
    minBytesPerChar: 50,
    needsMp3Repair: false,
  },
  deepinfra: {
    /** Name used in error messages. */
    name: "DeepInfra",
    label: "Kokoro (DeepInfra)",
    keyEnv: "DEEPINFRA_API_KEY",
    pricePerMillion: 0.99,
    minBytesPerChar: 30,
    // Kokoro puts an ID3 tag and Xing frame at the start of every sentence stream.
    needsMp3Repair: true,
  },
  elevenlabs: {
    /** Name used in error messages. */
    name: "ElevenLabs",
    label: "ElevenLabs",
    keyEnv: "ELEVENLABS_API_KEY",
    // Flash v2.5 API list price (about $0.06 per 1,000 characters); plan credits differ.
    pricePerMillion: 60,
    minBytesPerChar: 30,
    needsMp3Repair: false,
  },
} as const;

export type Provider = keyof typeof PROVIDER_INFO;

export type ParsedNarrator = {
  provider: Provider;
  /** "kokoro" for DeepInfra; undefined for OpenAI (the model comes from OPENAI_TTS_MODEL). */
  model?: string;
  voice: string;
};

/** Estimated USD per million characters. */
export const PRICE_PER_MILLION_CHARS = Object.fromEntries(
  Object.entries(PROVIDER_INFO).map(([k, v]) => [k, v.pricePerMillion]),
) as Record<Provider, number>;

export const PROVIDER_LABEL = Object.fromEntries(
  Object.entries(PROVIDER_INFO).map(([k, v]) => [k, v.label]),
) as Record<Provider, string>;

/** Environment variable that must be set for a provider to work. */
export const PROVIDER_KEY_ENV = Object.fromEntries(
  Object.entries(PROVIDER_INFO).map(([k, v]) => [k, v.keyEnv]),
) as Record<Provider, string>;

export const kokoroId = (voice: string) => `deepinfra:kokoro:${voice}`;
export const elevenLabsId = (voiceId: string) => `elevenlabs:flash:${voiceId}`;

/** Understand a narrator id, or null if it isn't one we know how to run. */
export function parseNarrator(id: unknown): ParsedNarrator | null {
  if (typeof id !== "string" || !id) return null;
  if (!id.includes(":")) return { provider: "openai", voice: id }; // legacy plain voice
  const [provider, model, voice, ...rest] = id.split(":");
  if (rest.length || !voice) return null;
  if (provider === "deepinfra" && model === "kokoro") return { provider: "deepinfra", model, voice };
  if (provider === "elevenlabs" && model === "flash") return { provider: "elevenlabs", model, voice };
  return null;
}

/** Only narrators offered in the UI. Anything else becomes undefined. */
export function sanitizeNarrator(id: unknown): string | undefined {
  const parsed = parseNarrator(id);
  if (!parsed || typeof id !== "string") return undefined;
  if (parsed.provider === "openai") return (VOICES as readonly string[]).includes(id) ? id : undefined;
  if (parsed.provider === "elevenlabs") return ELEVENLABS_VOICES.some((v) => v.id === parsed.voice) ? id : undefined;
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

/** What a Kokoro voice name says about it: "af_bella" is an American ("a") female ("f") voice, "bm_george" a British male one. */
export function kokoroTraits(voice: string): string {
  const accent = voice.startsWith("b") ? "British" : "American";
  const gender = voice.charAt(1) === "m" ? "male" : "female";
  return `${accent}, ${gender}`;
}

/** "Ballad" for an OpenAI voice, "Bella (Kokoro)" for the others. */
export function narratorLabel(id: string | undefined): string {
  const parsed = parseNarrator(id);
  if (!parsed) return id ?? "";
  if (parsed.provider === "elevenlabs") {
    return `${ELEVENLABS_VOICES.find((v) => v.id === parsed.voice)?.name ?? "Voice"} (ElevenLabs)`;
  }
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
    narrators: KOKORO_VOICES.map((v) => ({ id: kokoroId(v), label: `${prettyVoice(v)} · ${kokoroTraits(v)}` })),
  },
  {
    provider: "elevenlabs",
    label: PROVIDER_LABEL.elevenlabs,
    pricePerMillion: PRICE_PER_MILLION_CHARS.elevenlabs,
    narrators: ELEVENLABS_VOICES.map((v) => ({ id: elevenLabsId(v.id), label: `${v.name} · ${v.traits}` })),
  },
];
