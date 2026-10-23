import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from "../settings-shared";
import { getObject, putObject } from "./storage";

export * from "../settings-shared";

export async function getSettings(): Promise<Settings> {
  const raw = await getObject("settings.json");
  if (!raw)
    return { ...DEFAULT_SETTINGS, voice: process.env.OPENAI_TTS_VOICE || DEFAULT_SETTINGS.voice };
  try {
    return sanitizeSettings(JSON.parse(raw.toString("utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(input: unknown): Promise<Settings> {
  const next = sanitizeSettings(input, await getSettings());
  await putObject("settings.json", JSON.stringify(next), "application/json");
  return next;
}
