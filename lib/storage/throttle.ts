import { createHash } from "node:crypto";
import { getObject, putObject } from "./storage";

/** Slow down password guessing: 5 wrong tries lock an address out for 15 minutes. */
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

type Record = { fails: number; since: number };

const keyFor = (ip: string) =>
  `throttle/${createHash("sha256").update(ip).digest("hex").slice(0, 16)}.json`;

async function read(ip: string): Promise<Record | null> {
  const raw = await getObject(keyFor(ip));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw.toString("utf8")) as Record;
    return Date.now() - rec.since > WINDOW_MS ? null : rec;
  } catch {
    return null;
  }
}

export async function isBlocked(ip: string): Promise<boolean> {
  return ((await read(ip))?.fails ?? 0) >= MAX_FAILS;
}

export async function recordFailure(ip: string): Promise<void> {
  const rec = (await read(ip)) ?? { fails: 0, since: Date.now() };
  rec.fails += 1;
  await putObject(keyFor(ip), JSON.stringify(rec), "application/json");
}

export async function clearFailures(ip: string): Promise<void> {
  if (await read(ip))
    await putObject(
      keyFor(ip),
      JSON.stringify({ fails: 0, since: Date.now() }),
      "application/json",
    );
}
