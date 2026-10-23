"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDialog } from "@/components/Dialog";
import { STALE_MS } from "@/components/PlayerProvider";
import { estimateMs, formatEta } from "@/lib/eta";
import { formatUsd, costUsd, providerOf } from "@/lib/narrators-shared";
import { getQueue, jobAction, type QueueState } from "@/lib/client/api";

type Queue = QueueState;

export default function QueuePage() {
  const dialog = useDialog();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setQueue(await getQueue());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the queue.");
    }
  }, []);

  // Look every 15 s while something is running; otherwise just once on opening.
  const anyRunning =
    (queue?.items.some((i) => i.job.status === "running") || (queue?.live.length ?? 0) > 0) ??
    false;
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    if (
      action === "cancel" &&
      !(await dialog.confirm({
        title: "Cancel this job?",
        body: "Chapters already narrated are kept.",
        confirmLabel: "Cancel job",
        cancelLabel: "Keep going",
      }))
    )
      return;
    await jobAction(id, action).catch(() => setError(`Couldn't ${action} that job.`));
    await load();
  }

  return (
    <main className="screen">
      <div className="eyebrow">In the background</div>
      <h1 className="display">Queue</h1>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {queue && queue.items.length === 0 && queue.live.length === 0 ? (
        <p className="empty">
          Nothing is being narrated right now. Anything being read aloud shows up here, whether you
          pressed play or started &ldquo;Read it all&rdquo;.
        </p>
      ) : null}

      <div className="queue">
        {queue?.live.map((l) => (
          <div key={`${l.id}:${l.chapter}`} className="continue">
            <Link href={`/book/${l.id}`} style={{ textDecoration: "none" }}>
              <div className="name">{l.title}</div>
              {l.author ? (
                <div className="muted" style={{ marginTop: 4 }}>
                  {l.author}
                </div>
              ) : null}
              <div className="faint" style={{ marginTop: 10, fontSize: 13 }}>
                Reading chapter {l.chapter + 1} aloud now · started by pressing play
              </div>
            </Link>
          </div>
        ))}
        {queue?.items.map(({ id, title, author, voice, job, remainingChars }) => {
          const stalled = job.status === "running" && Date.now() - job.updatedAt > STALE_MS;
          const from = job.from ?? 0;
          const to = job.to ?? job.total - 1;
          const doneCount = Math.max(0, Math.min(job.chapter, to + 1) - from);
          const count = to - from + 1;
          const eta = estimateMs(remainingChars, queue.speed[providerOf(voice)]);
          const state =
            job.status === "error"
              ? `Stopped: ${job.error ?? "something went wrong"}`
              : stalled
                ? "Looks stalled"
                : job.status === "paused"
                  ? "Paused"
                  : `Reading chapter ${Math.min(job.chapter + 1, job.total)} now`;
          return (
            <div key={id} className="continue">
              <Link href={`/book/${id}/narrating`} style={{ textDecoration: "none" }}>
                <div className="name">{title}</div>
                {author ? (
                  <div className="muted" style={{ marginTop: 4 }}>
                    {author}
                  </div>
                ) : null}
                <div
                  className={job.status === "error" ? "error" : "faint"}
                  style={{ marginTop: 10, fontSize: 13 }}
                >
                  {state}
                </div>
              </Link>
              <div className="hairline" style={{ marginTop: 12 }}>
                <i style={{ width: `${Math.min(100, (doneCount / count) * 100)}%` }} />
              </div>
              <div className="faint" style={{ marginTop: 8, fontSize: 13 }}>
                {doneCount} of {count} chapters · {job.status === "paused" ? "paused, " : ""}
                {remainingChars > 0
                  ? `${eta === null ? "time left not known yet" : `${formatEta(eta)} left`} · about ${formatUsd(costUsd(remainingChars, voice))} to go`
                  : "nearly done"}
              </div>
              <div className="qbtns">
                {job.status === "running" && !stalled ? (
                  <button className="btn" onClick={() => void act(id, "pause")}>
                    Pause
                  </button>
                ) : (
                  <button className="btn" onClick={() => void act(id, "resume")}>
                    {job.status === "paused" ? "Continue" : "Resume"}
                  </button>
                )}
                <button className="btn" onClick={() => void act(id, "cancel")}>
                  Cancel
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
