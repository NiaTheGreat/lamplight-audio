import { addSample, type SpeedStats } from "./eta";
import { providerOf } from "./narrators-shared";
import { getObject, putObject } from "./storage";

const KEY = "stats/speed.json";
const pending: { provider: "openai" | "deepinfra"; chars: number; ms: number }[] = [];

export async function getSpeed(): Promise<SpeedStats> {
  try {
    const raw = await getObject(KEY);
    return raw ? (JSON.parse(raw.toString("utf8")) as SpeedStats) : {};
  } catch {
    return {};
  }
}

/** Remember how fast a chapter was narrated; written out by flushSpeed (once per worker run). */
export function recordSpeed(narrator: string | undefined, chars: number, ms: number): void {
  if (chars > 0 && ms > 0) pending.push({ provider: providerOf(narrator), chars, ms });
}

export async function flushSpeed(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending.splice(0);
  try {
    const stats = await getSpeed();
    for (const s of batch) stats[s.provider] = addSample(stats[s.provider], s.chars, s.ms);
    await putObject(KEY, JSON.stringify(stats), "application/json");
  } catch {
    /* estimates are best-effort */
  }
}
