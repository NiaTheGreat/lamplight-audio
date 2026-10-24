// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NarratorOptions } from "@/components/NarratorOptions";
import type { NarratorGroupInfo } from "@/components/useNarrators";
import { NARRATOR_GROUPS } from "@/lib/narrators-shared";

afterEach(cleanup);

const groups = (configured: Record<string, boolean>): NarratorGroupInfo[] =>
  NARRATOR_GROUPS.map((g) => ({ ...g, configured: configured[g.provider] ?? true }));

function options(props: Partial<Parameters<typeof NarratorOptions>[0]>, configured = {}) {
  const view = render(
    createElement(
      "select",
      null,
      createElement(NarratorOptions, { groups: groups(configured), ...props }),
    ),
  );
  return {
    groups: [...view.container.querySelectorAll("optgroup")],
    options: [...view.container.querySelectorAll("option")],
  };
}

describe("NarratorOptions", () => {
  it("shows every provider with its price", () => {
    const { groups: g } = options({});
    expect(g.map((x) => x.label)).toEqual(
      expect.arrayContaining([expect.stringContaining("per million characters")]),
    );
    expect(g.length).toBe(NARRATOR_GROUPS.length);
  });

  it("can leave the price out", () => {
    const { groups: g } = options({ showPrice: false });
    expect(g.every((x) => !x.label.includes("per million"))).toBe(true);
  });

  it("disables narrators whose provider has no key, and says so", () => {
    const { options: o } = options({}, { deepinfra: false });
    const kokoro = o.filter((x) => x.value.startsWith("deepinfra:"));
    expect(kokoro.length).toBeGreaterThan(0);
    expect(kokoro.every((x) => x.disabled && x.textContent!.endsWith("(needs a key)"))).toBe(true);
    expect(o.find((x) => x.value === "ballad")!.disabled).toBe(false);
  });

  it("can hide the key hint", () => {
    const { options: o } = options({ hideKeyHint: true }, { deepinfra: false });
    expect(o.find((x) => x.value.startsWith("deepinfra:"))!.textContent).not.toContain(
      "needs a key",
    );
  });

  it("keeps the narrator in use selectable and can mark it current", () => {
    const id = NARRATOR_GROUPS.find((g) => g.provider === "deepinfra")!.narrators[0].id;
    const { options: o } = options({ keep: id, markKept: true }, { deepinfra: false });
    const kept = o.find((x) => x.value === id)!;
    expect(kept.disabled).toBe(false);
    expect(kept.textContent).toContain("(current)");
    expect(o.find((x) => x.value !== id && x.value.startsWith("deepinfra:"))!.disabled).toBe(true);
  });

  it("can leave one narrator out", () => {
    const { options: o } = options({ exclude: "ballad" });
    expect(o.some((x) => x.value === "ballad")).toBe(false);
    expect(o.some((x) => x.value === "nova")).toBe(true);
  });
});
