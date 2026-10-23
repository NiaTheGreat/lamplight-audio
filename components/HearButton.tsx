"use client";

import { useEffect, useRef, useState } from "react";

/** Plays a respelling in a narrator so you can check it before spending on a chapter. */
export function HearButton({ text, voice }: { text: string; voice?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  async function hear() {
    audio.current?.pause();
    setError("");
    setState("loading");
    try {
      const res = await fetch(
        `/api/pronounce?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice ?? "")}`,
      );
      if (!res.ok) throw new Error((await res.text()) || "Couldn't make that.");
      const a = new Audio(URL.createObjectURL(await res.blob()));
      audio.current = a;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 120) : "Couldn't play that.");
      setState("idle");
    }
  }

  return (
    <>
      <button
        className="btn"
        style={{ minWidth: 0, padding: "0 14px" }}
        disabled={!text.trim() || state === "loading"}
        onClick={() => void hear()}
        aria-label={`Hear ${text}`}
      >
        {state === "loading" ? "…" : "Hear"}
      </button>
      {error ? (
        <span className="error" role="alert" style={{ gridColumn: "1 / -1" }}>
          {error}
        </span>
      ) : null}
    </>
  );
}
