"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { useNarrators } from "@/components/useNarrators";
import { formatUsd } from "@/lib/narrators-shared";
import { SLEEP_OPTIONS, SPEEDS } from "@/lib/settings-shared";

const sleepLabel = (m: number) => (m === 0 ? "Off" : m === -1 ? "Ch. end" : String(m));

export default function Settings() {
  const p = usePlayer();
  const { settings, updateSettings } = p;
  const groups = useNarrators();
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [hearing, setHearing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [usage, setUsage] = useState<{ chars: number; usd: number; limitUsd: number } | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => previewRef.current?.pause(), []);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => u && setUsage(u))
      .catch(() => {});
  }, []);

  async function hear(voice: string) {
    previewRef.current?.pause();
    setPreviewError("");
    setHearing(voice);
    try {
      // Fetch first so a failure shows the server's real message, and so the
      // first-time "making a sample" wait is visible.
      const res = await fetch(`/api/voices/${encodeURIComponent(voice)}/preview`);
      if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      previewRef.current = audio;
      const done = () => {
        URL.revokeObjectURL(url);
        setHearing((v) => (v === voice ? null : v));
      };
      audio.onended = done;
      audio.onerror = () => {
        done();
        setPreviewError("The sample downloaded but wouldn't play.");
      };
      await audio.play();
    } catch (err) {
      setHearing(null);
      setPreviewError(err instanceof Error ? err.message : "Couldn't play that preview.");
    }
  }

  return (
    <main className="screen">
      <h1 className="display" style={{ marginTop: 0 }}>Settings</h1>

      <section className="section" aria-label="Narrator">
        <div className="eyebrow">Narrator for new fics</div>
        {groups.map((g) => {
          // The chosen narrator first, then the rest; collapsed to four until expanded.
          const ordered = [...g.narrators].sort(
            (a, b) => Number(b.id === settings.voice) - Number(a.id === settings.voice),
          );
          const open = showAll[g.provider];
          const shown = open ? ordered : ordered.slice(0, 4);
          return (
            <div key={g.provider} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span className="serif" style={{ fontSize: 17 }}>{g.label}</span>
                <span className="faint">about {formatUsd(g.pricePerMillion)} per million characters</span>
              </div>
              {!g.configured ? (
                <p className="faint" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  Not set up yet. Add {g.keyName} in Vercel to use these voices.
                </p>
              ) : null}
              {shown.map((n) => (
                <div key={n.id} className={`voice ${n.id === settings.voice ? "chosen" : ""}`}>
                  <button
                    className="pick"
                    role="radio"
                    aria-checked={n.id === settings.voice}
                    disabled={!g.configured}
                    onClick={() => void updateSettings({ voice: n.id })}
                  >
                    <span className="slot">{n.id === settings.voice ? <Icon name="check" size={20} stroke={1.75} /> : null}</span>
                    <span>{n.label}</span>
                  </button>
                  <button className="hear" aria-label={`Hear ${n.label}`} disabled={!g.configured} onClick={() => hear(n.id)}>
                    <Icon name="play" size={18} />
                    {hearing === n.id ? "Making a sample…" : "Hear"}
                  </button>
                </div>
              ))}
              {g.narrators.length > 4 ? (
                <button className="link-btn" onClick={() => setShowAll((v) => ({ ...v, [g.provider]: !open }))}>
                  {open ? "Show fewer voices" : `Show all ${g.narrators.length} voices`}
                  <Icon name="chevronDown" size={20} />
                </button>
              ) : null}
            </div>
          );
        })}
        {previewError ? <p className="error" role="alert">{previewError}</p> : null}
        <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Each fic keeps the narrator it was added with, so a half-listened story never changes narrator.
        </p>
      </section>

      <section className="section" aria-label="Pronunciation lists">
        <div className="eyebrow">Pronunciation lists</div>
        <p className="faint" style={{ margin: "8px 0 12px", lineHeight: 1.5 }}>
          Named lists of how to say names and words. Copied into a fic when you add it.
        </p>
        <Link href="/pronunciations" className="btn">Manage lists</Link>
      </section>

      <section className="section" aria-label="Default speed">
        <div className="eyebrow">Default speed</div>
        <div className="seg" role="radiogroup" aria-label="Default speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={Math.abs(settings.speed - s) < 0.01} onClick={() => void updateSettings({ speed: s })}>
              {s}×
            </button>
          ))}
        </div>
      </section>

      <section className="section" aria-label="Default sleep timer">
        <div className="eyebrow">Default sleep timer</div>
        <div className="seg" role="radiogroup" aria-label="Default sleep timer">
          {SLEEP_OPTIONS.map((m) => (
            <button key={m} role="radio" aria-checked={settings.sleep === m} onClick={() => void updateSettings({ sleep: m })}>
              {sleepLabel(m)}
            </button>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Minutes. Playback pauses; it doesn&apos;t fade out.
        </p>
      </section>

      <section className="section" aria-label="Screen dimming">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span className="eyebrow">Screen dimming</span>
          <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>{p.dim}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Screen dimming"
          value={p.dim}
          style={{ ["--pct" as string]: `${p.dim}%` }}
          onChange={(e) => void updateSettings({ dim: Number(e.target.value) })}
        />
      </section>

      {usage ? (
        <section className="section" aria-label="Spending">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="eyebrow">Spent on narration this month</span>
            <span className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatUsd(usage.usd)} of {formatUsd(usage.limitUsd)}
            </span>
          </div>
          <div className="hairline" style={{ marginTop: 10 }}>
            <i style={{ width: `${Math.min(100, (usage.usd / usage.limitUsd) * 100)}%` }} />
          </div>
          <p className="faint" style={{ marginTop: 8, lineHeight: 1.5 }}>
            An estimate from each narrator&apos;s price per character. Narration stops at the limit; raise
            MONTHLY_BUDGET_USD in Vercel to continue.
          </p>
        </section>
      ) : null}

      <section className="section" aria-label="Asking first">
        <div className="option">
          <div className="grow">
            <div className="label">Ask before narrating a chapter</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
              Shows the cost and lets you cancel, so a stray tap doesn&apos;t spend money. Chapters already narrated play without asking.
            </div>
          </div>
          <button role="switch" aria-checked={p.confirmNarrate} aria-label="Ask before narrating a chapter" className="switch" onClick={() => p.setConfirmNarrate(!p.confirmNarrate)} />
        </div>
      </section>

      <section className="section" aria-label="Narrating ahead">
        <div className="option">
          <div className="grow">
            <div className="label">Narrate the next chapter while I listen</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
              So the next chapter starts the moment this one ends. Turn off to spend less.
            </div>
          </div>
          <button role="switch" aria-checked={p.autoNext} aria-label="Narrate the next chapter while I listen" className="switch" onClick={() => p.setAutoNext(!p.autoNext)} />
        </div>
      </section>
    </main>
  );
}
