import type { TtsProvider } from "./types";

const KOKORO_MODEL = "hexgrad/Kokoro-82M";
const base = () => process.env.DEEPINFRA_BASE_URL || "https://api.deepinfra.com/v1/openai";

export const deepinfra: TtsProvider = {
  id: "deepinfra",
  cacheLayout: (text, _narrator, voice) => ["narrator-v1", "deepinfra", KOKORO_MODEL, voice, text],
  request: (input, voice, apiKey) => ({
    url: `${base()}/audio/speech`,
    headers: { Authorization: `Bearer ${apiKey}` },
    // DeepInfra defaults to WAV; chapters are joined by concatenating MP3 frames.
    body: { model: KOKORO_MODEL, voice, input, response_format: "mp3" },
  }),
};
