import type { TtsProvider } from "./types";

const model = () => process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5";
const base = () => process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io";

export const elevenlabs: TtsProvider = {
  id: "elevenlabs",
  cacheLayout: (text, _narrator, voice) => ["narrator-v1", "elevenlabs", model(), voice, text],
  request: (input, voice, apiKey) => ({
    url: `${base()}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    headers: { "xi-api-key": apiKey },
    body: { text: input, model_id: model() },
  }),
};
