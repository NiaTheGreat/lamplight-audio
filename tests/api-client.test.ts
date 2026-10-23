// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  changeBookPronunciation,
  changeNarrator,
  getBook,
  getQueue,
  getSpeed,
  jobAction,
  pronunciationListsOrEmpty,
  repairChapter,
  saveSettings,
} from "@/lib/client/api";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";

type Reply = { status?: number; body?: unknown } | "network-error";
let reply: Reply;
let last: { url: string; init?: RequestInit };

beforeEach(() => {
  reply = { body: {} };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      last = { url, init };
      if (reply === "network-error") throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(reply.body ?? null), { status: reply.status ?? 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("api client: errors", () => {
  it("throws the server's own message when it sent one", async () => {
    reply = { status: 409, body: { error: "A job is already running." } };
    await expect(changeNarrator("b1", "nova")).rejects.toMatchObject({ message: "A job is already running.", status: 409 });
  });

  it("falls back to its own message when the server sent none", async () => {
    reply = { status: 500, body: null };
    const err = await changeBookPronunciation("b1", "PUT", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("That didn't work.");
  });

  it("lets a dropped connection through as the browser's own error", async () => {
    reply = "network-error";
    await expect(getQueue()).rejects.toThrow("Failed to fetch");
  });
});

describe("api client: requests", () => {
  it("sends JSON bodies with the right method and URL", async () => {
    await jobAction("b1", "pause");
    expect(last.url).toBe("/api/books/b1/narrate");
    expect(last.init?.method).toBe("PATCH");
    expect(JSON.parse(String(last.init?.body))).toEqual({ action: "pause" });
    expect((last.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("asks for the queue fresh every time", async () => {
    reply = { body: { items: [], live: [], speed: {} } };
    await getQueue();
    expect(last.init?.cache).toBe("no-store");
  });
});

describe("api client: soft calls never throw", () => {
  it("returns null or a default when the request fails", async () => {
    reply = "network-error";
    expect(await getBook("b1")).toBeNull();
    expect(await getSpeed()).toEqual({});
    expect(await pronunciationListsOrEmpty()).toEqual({ lists: [] });
    expect(await saveSettings(DEFAULT_SETTINGS)).toBeNull();
    reply = { status: 500, body: { error: "nope" } };
    expect(await getBook("b1")).toBeNull();
    expect(await repairChapter("b1", 2)).toBeNull();
  });

  it("returns the data when it works", async () => {
    reply = { body: { rebuilt: 3 } };
    expect(await repairChapter("b1", 2)).toBe(3);
    expect(JSON.parse(String(last.init?.body))).toEqual({ chapter: 2 });
    reply = { body: { ...DEFAULT_SETTINGS, speed: 1.3 } };
    expect((await saveSettings({ ...DEFAULT_SETTINGS, speed: 1.3 }))?.speed).toBe(1.3);
  });
});
