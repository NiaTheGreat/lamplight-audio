"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { usePlayer } from "@/components/PlayerProvider";
import { SLEEP_OPTIONS, SPEEDS, VOICES } from "@/lib/settings-shared";

const sleepLabel = (m: number) => (m === 0 ? "Off" : m === -1 ? "Ch. end" : String(m));

export default function Settings() {
  const p = usePlayer();
  const { settings, updateSettings } = p;
  const [showAll, setShowAll] = useState(false);
  const [hearing, setHearing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => previewRef.current?.pause(), []);

  async function hear(voice: string) {
    previewRef.current?.pause();
    setPreviewError("");
    setHearing(voice);
    try {
      // Fetch first so a failure shows the server's real message, and so the
      // first-time "making a sample" wait is visible.
      const res = await fetch(`/api/voices/${voice}/preview`);
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

  const ordered = [settings.voice, ...VOICES.filter((v) => v !== settings.voice)];
  const shown = showAll ? ordered : ordered.slice(0, 4);

  return (
    <main className="screen">
      <h1 className="display" style={{ marginTop: 0 }}>Settings</h1>

      <section className="section" aria-label="Voice">
        <div className="eyebrow">Voice for new fics</div>
        <div>
          {shown.map((v) => (
            <div key={v} className={`voice ${v === settings.voice ? "chosen" : ""}`}>
              <button
                className="pick"
                role="radio"
                aria-checked={v === settings.voice}
                onClick={() => void updateSettings({ voice: v })}
              >
                <span className="slot">{v === settings.voice ? <Icon name="check" size={20} stroke={1.75} /> : null}</span>
                <span style={{ textTransform: "capitalize" }}>{v}</span>
              </button>
              <button className="hear" aria-label={`Hear ${v}`} onClick={() => hear(v)}>
                <Icon name="play" size={18} />
                {hearing === v ? "Making a sample…" : "Hear"}
              </button>
            </div>
          ))}
          <button className="link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer voices" : "Show all voices"}
            <Icon name="chevronDown" size={20} />
          </button>
        </div>
        {previewError ? <p className="error" role="alert">{previewError}</p> : null}
        <p className="faint" style={{ marginTop: 4, lineHeight: 1.5 }}>
          Each fic keeps the voice it was added with, so a half-listened story never changes narrator.
        </p>
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
