/**
 * Waiting out a provider that is busy. Pure, so it is easy to test; the loop that uses it is
 * synthChunk in tts.ts.
 */

/** Tunable so tests don't have to wait. */
export const retryTiming = {
  /** Tries per chunk, the first included. */
  maxAttempts: 6,
  /** First wait; doubles each time up to `capMs`. */
  baseMs: 3_000,
  capMs: 30_000,
  /** The longest we will honor a Retry-After header for. */
  retryAfterCapMs: 60_000,
};

/** A provider saying "too many requests" or "overloaded", as opposed to an empty balance or a bad request. */
export function isBusyResponse(status: number, detail: string): boolean {
  if (detail.includes("insufficient_quota")) return false; // waiting won't add funds
  return status === 429 || status === 503;
}

/** Milliseconds to wait before retry number `attempt` (0 = after the first failure). Exponential, with jitter. */
export function backoffMs(
  attempt: number,
  retryAfter?: string | null,
  rand: () => number = Math.random,
): number {
  const asked = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(asked) && asked >= 0)
    return Math.min(asked * 1000, retryTiming.retryAfterCapMs);
  const exp = Math.min(retryTiming.baseMs * 2 ** attempt, retryTiming.capMs);
  return Math.round(exp * (0.5 + rand() * 0.5)); // 50-100% of the step, so parallel chunks don't retry in lockstep
}

/** Thrown when a provider stayed busy through every retry. Nothing was spent. */
export class ProviderBusyError extends Error {
  constructor(
    /** Provider name for messages, e.g. "DeepInfra". */
    readonly providerName: string,
    /** The narrator id the chunk was for. */
    readonly narrator: string,
    detail: string,
  ) {
    super(`${providerName} is busy right now (${detail}). Nothing was spent.`);
  }
}
