import type { ReactNode } from "react";

// One thin line-icon set: 24px grid, 1.5px strokes, round caps and joins.
const PATHS: Record<string, ReactNode> = {
  play: <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  prev: <path d="M7 6v12M18 6l-8 6 8 6z" />,
  next: <path d="M17 6v12M6 6l8 6-8 6z" />,
  back15: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4M4.5 4.5v3.8h3.8" />
      <text
        x="12"
        y="15"
        fontSize="6.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontWeight="600"
      >
        15
      </text>
    </>
  ),
  fwd15: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4M19.5 4.5v3.8h-3.8" />
      <text
        x="12"
        y="15"
        fontSize="6.5"
        textAnchor="middle"
        fill="currentColor"
        stroke="none"
        fontWeight="600"
      >
        15
      </text>
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6" />
    </>
  ),
  speed: <path d="M5 17a8 8 0 1 1 14 0M12 13l3.5-4.5" />,
  download: <path d="M12 4v10M7.5 10.5L12 15l4.5-4.5M5 19h14" />,
  queue: <path d="M4 7h16M4 12h16M4 17h9" />,
  add: <path d="M12 5v14M5 12h14" />,
  shelf: (
    <>
      <rect x="3" y="4" width="4" height="16" />
      <rect x="9" y="4" width="4" height="16" />
      <path d="M15 5.5l3.8-1 2.6 14.8-3.8 1z" />
    </>
  ),
  settings: (
    <>
      <path d="M4 8h9M19 8h1M4 16h1M11 16h9" />
      <circle cx="16" cy="8" r="2.2" />
      <circle cx="8" cy="16" r="2.2" />
    </>
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  ),
  book: (
    <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13" />
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  retry: <path d="M19 12a7 7 0 1 1-2.1-5M19 4.5v4h-4" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 24,
  stroke = 1.5,
  className,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The four chapter states from the design: each has its own shape, not just a colour. */
export function StateGlyph({
  state,
}: {
  state: "ready" | "reading" | "waiting" | "playing" | "failed";
}) {
  const label = {
    ready: "Ready",
    reading: "Reading aloud",
    waiting: "Waiting",
    playing: "Playing",
    failed: "Failed",
  }[state];
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
      className={`glyph glyph-${state}`}
    >
      {state === "ready" ? (
        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="1.75" />
      ) : null}
      {state === "reading" ? (
        <>
          <circle
            cx="12"
            cy="12"
            r="8"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.75"
          />
          <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeWidth="1.75" />
        </>
      ) : null}
      {state === "waiting" ? (
        <circle
          cx="12"
          cy="12"
          r="8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="2 3.4"
        />
      ) : null}
      {state === "playing" ? (
        <g fill="currentColor">
          <rect x="4" y="9" width="3.4" height="11" rx="1" />
          <rect x="10.3" y="4" width="3.4" height="16" rx="1" />
          <rect x="16.6" y="12" width="3.4" height="8" rx="1" />
        </g>
      ) : null}
      {state === "failed" ? (
        <>
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" />
          <path d="M12 7.8v5M12 16.2h.01" stroke="currentColor" strokeWidth="1.75" />
        </>
      ) : null}
    </svg>
  );
}

/** A small amber play button that marks a chapter as ready to play right now. */
export function PlayDot() {
  return (
    <span className="playdot" aria-hidden="true">
      <Icon name="play" size={14} />
    </span>
  );
}
