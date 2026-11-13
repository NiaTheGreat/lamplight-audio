"use client";

import type { ReaderView } from "./useReaderView";

/** The Listen | Read switch. Renders nothing when the reader is off. */
export function ViewSwitch({ reader }: { reader: ReaderView }) {
  if (!reader.enabled) return null;
  return (
    <div className="rd-switch" role="tablist" aria-label="View">
      {(["listen", "read"] as const).map((v) => (
        <button
          key={v}
          role="tab"
          aria-selected={reader.view === v || (v === "read" && reader.view === "book")}
          className={reader.view === v ? "on" : ""}
          onClick={() => reader.setView(v)}
        >
          {v === "listen" ? "Listen" : "Read"}
        </button>
      ))}
    </div>
  );
}
