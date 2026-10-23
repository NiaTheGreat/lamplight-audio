import type { TtsProvider } from "./types";

const model = () => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const supportsInstructions = () => model().startsWith("gpt-4o");
const instructions = () =>
  process.env.TTS_INSTRUCTIONS ||
  "Read this aloud as a warm, natural audiobook narrator. Keep a steady pace and give dialogue a little life.";

// gpt-4o-mini-tts sometimes clips the last words of a request. A trailing pad
// gives it something harmless to end on. Override with TTS_END_PAD (empty = off).
const endPad = () => process.env.TTS_END_PAD ?? "\n\n…";

export const openai: TtsProvider = {
  id: "openai",
  // The original layout: tests/cachekeys pins these keys.
  cacheLayout: (text, narrator) => [model(), narrator, supportsInstructions() ? instructions() : "", endPad(), text],
  request(input, voice, apiKey) {
    const body: Record<string, unknown> = {
      model: model(),
      voice,
      input: input + endPad(),
      response_format: "mp3",
    };
    if (supportsInstructions()) body.instructions = instructions();
    return {
      url: `${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/audio/speech`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    };
  },
};
