import type { Provider } from "../narrators-shared";

/** One speech request for one chunk of text. */
export type SpeechRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

/**
 * What a narration provider has to supply on the server. Retries, the budget check,
 * the completeness check and caching are shared in lib/narration/tts.ts; names, prices, key
 * names and size limits are in PROVIDER_INFO (lib/narrators-shared.ts).
 */
export type TtsProvider = {
  id: Provider;
  /** The cache-key parts for a chunk (hashed by audioKey). Never change these for existing narrators: audio already paid for lives under them. */
  cacheLayout(text: string, narrator: string, voice: string): string[];
  /** The request for one chunk. `apiKey` is already checked to be set. */
  request(input: string, voice: string, apiKey: string): SpeechRequest;
};
