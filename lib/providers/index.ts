import { parseNarrator, PROVIDER_INFO, type Provider } from "../narrators-shared";
import { deepinfra } from "./deepinfra";
import { elevenlabs } from "./elevenlabs";
import { openai } from "./openai";
import type { TtsProvider } from "./types";

/**
 * Server-side providers. To add one: a row in PROVIDER_INFO and narrator parsing/voices in
 * lib/narrators-shared.ts, a file here, and a line below (the types will point at each gap).
 */
const PROVIDERS: Record<Provider, TtsProvider> = { openai, deepinfra, elevenlabs };

/** The provider and bare voice for a narrator id (an unknown id is read as a plain OpenAI voice, as always). */
export function resolveNarrator(narrator: string): { provider: TtsProvider; voice: string } {
  const parsed = parseNarrator(narrator) ?? { provider: "openai" as const, voice: narrator };
  return { provider: PROVIDERS[parsed.provider], voice: parsed.voice };
}

export { PROVIDER_INFO };
export type { SpeechRequest, TtsProvider } from "./types";
