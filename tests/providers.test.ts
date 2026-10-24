import { describe, expect, it } from "vitest";
import { PROVIDER_INFO, type Provider } from "@/lib/narrators-shared";
import { resolveNarrator } from "@/lib/providers";

const SAMPLES: Record<Provider, string> = {
  openai: "ballad",
  deepinfra: "deepinfra:kokoro:af_bella",
  elevenlabs: "elevenlabs:flash:21m00Tcm4TlvDq8ikWAM",
};

describe("provider registry", () => {
  it("has a server provider for every provider in PROVIDER_INFO", () => {
    for (const id of Object.keys(PROVIDER_INFO) as Provider[]) {
      const { provider } = resolveNarrator(SAMPLES[id]);
      expect(provider.id).toBe(id);
    }
  });

  it("reads an unknown narrator as a plain OpenAI voice, as before", () => {
    const { provider, voice } = resolveNarrator("not-a-narrator:x");
    expect(provider.id).toBe("openai");
    expect(voice).toBe("not-a-narrator:x");
  });
});
