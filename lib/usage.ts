import { costUsd } from "./narrators-shared";
import { getObject, putObject } from "./storage";

/**
 * A monthly spending cap, so a runaway job (or anyone who learns the password) can't
 * spend without limit. Each narrator has its own price per million characters
 * (lib/narrators-shared.ts), so the cap is in dollars: MONTHLY_BUDGET_USD, default $30.
 * MONTHLY_CHAR_LIMIT is still honoured when set, as a second cap in characters.
 * Prices are estimates; free tiers are not modelled.
 */
export class BudgetError extends Error {}

export const monthlyBudgetUsd = () => Number(process.env.MONTHLY_BUDGET_USD) || 30;
/** 0 means no character cap. */
export const monthlyCharLimit = () => Number(process.env.MONTHLY_CHAR_LIMIT) || 0;

const monthKey = () => `usage/${new Date().toISOString().slice(0, 7)}.json`;

type Used = { chars: number; usd: number };

const currentMonth = () => new Date().toISOString().slice(0, 7);

async function readUsed(): Promise<Used> {
  const raw = await getObject(monthKey());
  if (!raw) return { chars: 0, usd: 0 };
  try {
    const rec = JSON.parse(raw.toString("utf8")) as { chars?: number; usd?: number };
    const chars = Number(rec.chars) || 0;
    // Months recorded before narrators existed only counted characters, all OpenAI.
    return { chars, usd: typeof rec.usd === "number" ? rec.usd : costUsd(chars, undefined) };
  } catch {
    return { chars: 0, usd: 0 };
  }
}

/*
 * Counting is batched to keep storage operations low. Each chunk adds to an in-memory
 * `pending` tally; the tally is written to storage once per chapter (flushUsage), as a
 * read-add-write so other server instances' totals aren't overwritten. The budget check
 * uses the last stored total (refreshed at most every 30 s) plus whatever is pending.
 */
const READ_TTL_MS = 30_000;
let stored: (Used & { month: string; at: number }) | null = null;
let pending: Used = { chars: 0, usd: 0 };

async function storedUsed(force = false): Promise<Used> {
  const month = currentMonth();
  if (!force && stored && stored.month === month && Date.now() - stored.at < READ_TTL_MS) return stored;
  stored = { ...(await readUsed()), month, at: Date.now() };
  return stored;
}

export async function getUsage(): Promise<{
  month: string;
  chars: number;
  usd: number;
  limitUsd: number;
  limitChars: number | null;
}> {
  const used = await storedUsed(true);
  return {
    month: currentMonth(),
    chars: used.chars + pending.chars,
    usd: used.usd + pending.usd,
    limitUsd: monthlyBudgetUsd(),
    limitChars: monthlyCharLimit() || null,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Refuse to start more narration once this month's cap would be passed. */
export async function assertBudget(chars: number, narrator?: string): Promise<void> {
  const base = await storedUsed();
  const used = { chars: base.chars + pending.chars, usd: base.usd + pending.usd };
  const limitChars = monthlyCharLimit();
  if (limitChars && used.chars + chars > limitChars) {
    throw new BudgetError(
      `Monthly narration limit reached (${fmt(used.chars)} of ${fmt(limitChars)} characters). Raise MONTHLY_CHAR_LIMIT to continue.`,
    );
  }
  const add = costUsd(chars, narrator);
  if (used.usd + add > monthlyBudgetUsd()) {
    throw new BudgetError(
      `Monthly narration budget reached ($${used.usd.toFixed(2)} of $${monthlyBudgetUsd().toFixed(2)}). Raise MONTHLY_BUDGET_USD to continue.`,
    );
  }
}

/** Count what was narrated. Held in memory until flushUsage(), which writes it to storage. */
export function recordUsage(chars: number, narrator?: string): Promise<void> {
  pending = { chars: pending.chars + chars, usd: pending.usd + costUsd(chars, narrator) };
  return Promise.resolve();
}

// One flush at a time, so two finishing chapters don't write over each other.
let flushing: Promise<void> = Promise.resolve();

/**
 * Write the pending tally to storage (one read, one write). Call at the end of a
 * chapter or any other unit of work, since a serverless function may be frozen right
 * after it responds. Separate server instances could still race, which only undercounts
 * slightly. Never fails a narration because the counter couldn't be saved.
 */
export function flushUsage(): Promise<void> {
  flushing = flushing.then(async () => {
    if (pending.chars === 0 && pending.usd === 0) return;
    const delta = pending;
    pending = { chars: 0, usd: 0 };
    try {
      const current = await readUsed();
      const next = { chars: current.chars + delta.chars, usd: current.usd + delta.usd };
      await putObject(monthKey(), JSON.stringify(next), "application/json");
      stored = { ...next, month: currentMonth(), at: Date.now() };
    } catch {
      // Keep the tally so the next flush retries it.
      pending = { chars: pending.chars + delta.chars, usd: pending.usd + delta.usd };
    }
  });
  return flushing;
}
