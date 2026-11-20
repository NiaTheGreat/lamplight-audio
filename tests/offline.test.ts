// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { audioSrc, isKept, keepChapter, removeChapter } from "@/lib/client/offline";

// A minimal Cache Storage and service worker, enough for the helper.
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    put: async (k: string, r: Response) => void store.set(k, r),
    delete: async (k: string) => store.delete(k),
  };
  vi.stubGlobal("caches", { open: async () => cache, delete: async () => true });
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
  return store;
}

describe("offline chapters", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("streams until a chapter is kept, then uses the kept copy", async () => {
    const store = fakeCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
    expect(audioSrc("b1", 2)).toBe("/api/audio/b1/2");
    expect(await keepChapter("b1", 2)).toBeNull();
    expect(isKept("b1", 2)).toBe(true);
    expect(audioSrc("b1", 2)).toBe("/offline-audio/b1/2");
    expect(store.has("/offline-audio/b1/2")).toBe(true);
    expect(audioSrc("b1", 3)).toBe("/api/audio/b1/3");
    await removeChapter("b1", 2);
    expect(audioSrc("b1", 2)).toBe("/api/audio/b1/2");
  });

  it("reports a failed download and keeps nothing", async () => {
    fakeCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    expect(await keepChapter("b1", 0)).toMatch(/narrated/);
    expect(isKept("b1", 0)).toBe(false);
  });
});
