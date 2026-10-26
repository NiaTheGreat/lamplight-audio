import { ELEVENLABS_MODELS, parseNarrator } from "../narrators-shared";
import type { TtsProvider } from "./types";

const base = () => process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

/** The API model id for a narrator. Flash (and old ids) can be overridden with ELEVENLABS_TTS_MODEL. */
function modelFor(narrator: string): string {
  const name = parseNarrator(narrator)?.model;
  if (name && name !== "flash" && name in ELEVENLABS_MODELS)
    return ELEVENLABS_MODELS[name as keyof typeof ELEVENLABS_MODELS].modelId;
  return process.env.ELEVENLABS_TTS_MODEL || ELEVENLABS_MODELS.flash.modelId;
}

export const elevenlabs: TtsProvider = {
  id: "elevenlabs",
  // The Flash layout is unchanged, so audio already narrated stays cached.
  cacheLayout: (text, narrator, voice) => [
    "narrator-v1",
    "elevenlabs",
    modelFor(narrator),
    voice,
    text,
  ],
  request: (input, voice, apiKey, narrator) => ({
    url: `${base()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    headers: { "xi-api-key": apiKey },
    body: { text: input, model_id: modelFor(narrator) },
  }),
};
