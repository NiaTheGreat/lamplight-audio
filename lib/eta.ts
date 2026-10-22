/** Narration speed, measured from real runs. Client-safe: no storage here. */
export type SpeedStat = { chars: number; ms: number };
export type SpeedStats = Partial<Record<"openai" | "deepinfra", SpeedStat>>;

/** Below this many measured characters the average means nothing yet. */
const MIN_SAMPLE_CHARS = 3000;

export function charsPerSecond(stat?: SpeedStat): number | null {
  if (!stat || stat.chars < MIN_SAMPLE_CHARS || stat.ms <= 0) return null;
  return (stat.chars / stat.ms) * 1000;
}

/** Milliseconds to narrate `chars` at the measured speed, or null while there's no data. */
export function estimateMs(chars: number, stat?: SpeedStat): number | null {
  const rate = charsPerSecond(stat);
  return rate ? (chars / rate) * 1000 : null;
}

/** "about 12 min", "about 2 h 10 min". */
export function formatEta(ms: number | null): string {
  if (ms === null) return "time not known yet";
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `about ${h} h ${m} min` : `about ${h} h`;
}

/** Keep the average recent: past this many characters, shrink the history by half. */
const MAX_HISTORY_CHARS = 2_000_000;

export function addSample(stat: SpeedStat | undefined, chars: number, ms: number): SpeedStat {
  let next = { chars: (stat?.chars ?? 0) + chars, ms: (stat?.ms ?? 0) + ms };
  if (next.chars > MAX_HISTORY_CHARS) next = { chars: next.chars / 2, ms: next.ms / 2 };
  return next;
}
