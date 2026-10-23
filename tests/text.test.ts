import { describe, expect, it } from "vitest";
import { splitForTts } from "@/lib/narration/text";

describe("splitForTts", () => {
  it("keeps short text in one chunk", () => {
    expect(splitForTts("One.\n\nTwo.")).toEqual(["One.\n\nTwo."]);
  });

  it("never exceeds the max and loses no words", () => {
    const sentence = "This is a perfectly ordinary sentence about nothing at all.";
    const paragraph = Array.from({ length: 400 }, () => sentence).join(" ");
    const text = `${paragraph}\n\nShort paragraph.\n\n${paragraph}`;
    const chunks = splitForTts(text, 1000);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    expect(chunks.reduce((n, c) => n + words(c), 0)).toBe(words(text));
  });

  it("splits one enormous unbroken token", () => {
    const chunks = splitForTts("a".repeat(2500), 1000);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 500]);
  });
});
