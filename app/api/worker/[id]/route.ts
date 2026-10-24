import { after } from "next/server";
import { tokenFor } from "@/lib/auth";
import { workerOrigin } from "@/lib/self-host";
import { runJob } from "@/lib/narration/narration";
import { BOOK_ID_RE } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Budget for one worker run, safely under maxDuration. */
const BUDGET_MS = 250_000;

/**
 * Internal: narrate part of a book's job. Answers at once, does the work after
 * the response, then calls itself again if the book isn't finished. The
 * middleware lets this through only with the worker token.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!BOOK_ID_RE.test(id)) return new Response("Bad request", { status: 400 });

  const password = process.env.APP_PASSWORD;
  const token = password ? await tokenFor(password) : "";
  const origin = workerOrigin(req);

  after(async () => {
    const result = await runJob(id, { budgetMs: BUDGET_MS });
    if (result.finished || result.skipped) return;
    await fetch(`${origin}/api/worker/${id}`, {
      method: "POST",
      headers: { "x-worker-token": token },
    }).catch(() => {});
  });

  return new Response(null, { status: 202 });
}
