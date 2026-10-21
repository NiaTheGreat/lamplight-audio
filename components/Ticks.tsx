/** One tick per chapter: filled for narrated chapters. Long books fall back to a plain bar. */
export function Ticks({ done, total, big = false }: { done: number; total: number; big?: boolean }) {
  const label = `${done} of ${total} chapters narrated`;
  if (big) {
    // Full-width strip; the tick pattern is tuned for about 22 chapters, so scale it.
    return (
      <div className="ticks solid big" role="img" aria-label={label}>
        <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    );
  }
  if (total > 40 || total === 0) {
    return (
      <div className="ticks solid" role="img" aria-label={label} style={{ width: 108 }}>
        <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    );
  }
  return (
    <div className="ticks" role="img" aria-label={label} style={{ width: total * 5 - 2 }}>
      <i style={{ width: Math.max(0, done * 5 - 2) }} />
    </div>
  );
}

const BINDINGS = ["#5a2a25", "#4a3524", "#3e4a3f", "#6b5128", "#4a3040"];

/** A stable spine colour per book. */
export function bindingFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BINDINGS[h % BINDINGS.length];
}
