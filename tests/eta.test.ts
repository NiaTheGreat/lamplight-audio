import { describe, expect, it } from "vitest";
import { addSample, estimateMs, formatEta } from "@/lib/eta";

describe("narration time estimates", () => {
  it("says nothing until there is enough data", () => {
    expect(estimateMs(10_000, undefined)).toBeNull();
    expect(estimateMs(10_000, { chars: 1000, ms: 5000 })).toBeNull();
    expect(formatEta(null)).toBe("time not known yet");
  });
  it("scales from the measured speed", () => {
    // 10,000 chars in 50 s = 200 chars/s, so 60,000 chars takes 300 s.
    expect(estimateMs(60_000, { chars: 10_000, ms: 50_000 })).toBeCloseTo(300_000);
  });
  it("formats minutes and hours", () => {
    expect(formatEta(20_000)).toBe("about 1 min");
    expect(formatEta(12 * 60_000)).toBe("about 12 min");
    expect(formatEta(130 * 60_000)).toBe("about 2 h 10 min");
  });
  it("keeps the average recent", () => {
    const s = addSample({ chars: 1_999_000, ms: 1_000_000 }, 2_000, 2_000);
    expect(s.chars).toBeLessThan(1_100_000);
  });
});
