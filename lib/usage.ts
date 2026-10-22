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

export async function getUsage(): Promise<{
  month: string;
  chars: number;
  usd: number;
  limitUsd: number;
  limitChars: number | null;
}> {
  const used = await readUsed();
  return {
    month: new Date().toISOString().slice(0, 7),
    chars: used.chars,
    usd: used.usd,
    limitUsd: monthlyBudgetUsd(),
    limitChars: monthlyCharLimit() || null,
  };
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Refuse to start more narration once this month's cap would be passed. */
export async function assertBudget(chars: number, narrator?: string): Promise<void> {
  const used = await readUsed();
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

// Chunks finish in parallel; queue the read-add-write so they don't overwrite each other.
let queue: Promise<void> = Promise.resolve();

/** Count what was actually narrated. Separate server instances could still race, which only undercounts slightly. */
export function recordUsage(chars: number, narrator?: string): Promise<void> {
  queue = queue.then(async () => {
    try {
      const used = await readUsed();
      await putObject(
        monthKey(),
        JSON.stringify({ chars: used.chars + chars, usd: used.usd + costUsd(chars, narrator) }),
        "application/json",
      );
    } catch {
      /* never fail a narration because the counter couldn't be saved */
    }
  });
  return queue;
}
