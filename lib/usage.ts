import { getObject, putObject } from "./storage";

/**
 * A monthly cap on characters sent to OpenAI, so a runaway job (or anyone who
 * learns the password) can't spend without limit. About $16 per million
 * characters; the default of 3 million is roughly $48 a month.
 */
export class BudgetError extends Error {}

export const monthlyLimit = () => Number(process.env.MONTHLY_CHAR_LIMIT) || 3_000_000;

const monthKey = () => `usage/${new Date().toISOString().slice(0, 7)}.json`;

async function readChars(): Promise<number> {
  const raw = await getObject(monthKey());
  if (!raw) return 0;
  try {
    return Number((JSON.parse(raw.toString("utf8")) as { chars?: number }).chars) || 0;
  } catch {
    return 0;
  }
}

export async function getUsage(): Promise<{ month: string; chars: number; limit: number }> {
  return { month: new Date().toISOString().slice(0, 7), chars: await readChars(), limit: monthlyLimit() };
}

/** Refuse to start more narration once this month's cap would be passed. */
export async function assertBudget(chars: number): Promise<void> {
  const used = await readChars();
  if (used + chars > monthlyLimit()) {
    throw new BudgetError(
      `Monthly narration limit reached (${used.toLocaleString("en-US")} of ${monthlyLimit().toLocaleString("en-US")} characters). Raise MONTHLY_CHAR_LIMIT to continue.`,
    );
  }
}

// Chunks finish in parallel; queue the read-add-write so they don't overwrite each other.
let queue: Promise<void> = Promise.resolve();

/** Count characters actually narrated. Separate server instances could still race, which only undercounts slightly. */
export function recordUsage(chars: number): Promise<void> {
  queue = queue.then(async () => {
    try {
      const used = await readChars();
      await putObject(monthKey(), JSON.stringify({ chars: used + chars }), "application/json");
    } catch {
      /* never fail a narration because the counter couldn't be saved */
    }
  });
  return queue;
}
