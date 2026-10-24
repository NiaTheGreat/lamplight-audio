"use client";

import { useCallback, useRef, useState } from "react";
import type { Sleep } from "./types";

const ORDER = [0, 15, 30, 60, -1]; // minutes; 0 = off, -1 = end of chapter

/** The sleep timer's state. Playback checks `sleepRef` as audio plays and calls `setSleep` when it fires. */
export function useSleepTimer() {
  const sleepRef = useRef<Sleep>({ kind: "off" });
  const [sleep, setSleepState] = useState<Sleep>({ kind: "off" });

  const setSleep = useCallback((value: Sleep) => {
    sleepRef.current = value;
    setSleepState(value);
  }, []);

  const setSleepMinutes = useCallback(
    (minutes: number) => {
      if (minutes === 0) setSleep({ kind: "off" });
      else if (minutes === -1) setSleep({ kind: "chapter" });
      else setSleep({ kind: "minutes", minutes, endsAt: Date.now() + minutes * 60_000 });
    },
    [setSleep],
  );

  const cycleSleep = useCallback(() => {
    const cur = sleepRef.current;
    const curVal = cur.kind === "off" ? 0 : cur.kind === "chapter" ? -1 : cur.minutes;
    const i = ORDER.indexOf(curVal);
    setSleepMinutes(ORDER[(i + 1) % ORDER.length]);
  }, [setSleepMinutes]);

  return { sleep, sleepRef, setSleep, setSleepMinutes, cycleSleep };
}
