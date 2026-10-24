// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import type { BookSummary } from "@/lib/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/book/b1" }));

import { PlayerProvider, usePlayer } from "@/components/PlayerProvider";

const BOOK: BookSummary = {
  id: "b1",
  title: "Test Fic",
  author: "Someone",
  voice: "ballad",
  narrated: [0, 1],
  chapters: [
    { index: 0, title: "One", chars: 3000 },
    { index: 1, title: "Two", chars: 3000 },
    { index: 2, title: "Three", chars: 3000 },
  ],
};

type Call = { method: string; url: string; body?: unknown };
let calls: Call[];
let server: {
  book: BookSummary;
  progress: unknown;
  job: unknown;
  audioProgress: { ready: number; total: number };
  postNarrate: { ok: boolean };
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url === "/api/books") return json([]);
    if (url === "/api/progress" && method === "GET") return json(server.progress);
    if (url === "/api/progress" && method === "PUT")
      return json({ last: body, books: { [body.id]: body } });
    if (url === "/api/settings") return json(method === "PUT" ? body : DEFAULT_SETTINGS);
    if (url === "/api/books/b1") return json(server.book);
    if (url === "/api/books/b1/narrate") {
      if (method === "POST")
        return server.postNarrate.ok
          ? json({ status: "running", chapter: 2, total: 3, updatedAt: 1 })
          : json({ error: "busy" }, 409);
      if (method === "PATCH")
        return json({
          status: body.action === "pause" ? "paused" : "running",
          chapter: 2,
          total: 3,
          updatedAt: 1,
        });
      if (method === "DELETE") return json(null);
      return json(server.job);
    }
    if (url.startsWith("/api/audio/b1/") && url.endsWith("?progress=1"))
      return json(server.audioProgress);
    if (url.startsWith("/api/audio/b1/") && url.endsWith("?prepare=1"))
      return new Response("", { status: 200 });
    return new Response("not mocked: " + url, { status: 404 });
  });
}

// jsdom doesn't play media. Make the audio element behave enough for the player.
let audio: HTMLAudioElement;
function installMediaStubs() {
  const proto = HTMLMediaElement.prototype;
  vi.spyOn(proto, "play").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(proto, "pause").mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
}

let player: ReturnType<typeof usePlayer>;
function Probe() {
  player = usePlayer();
  return null;
}

async function mount() {
  const view = render(createElement(PlayerProvider, null, createElement(Probe)));
  audio = view.container.querySelector("audio") as HTMLAudioElement;
  await act(async () => {});
  return view;
}

const flush = () => act(async () => {});
const fire = (type: string) => act(async () => void audio.dispatchEvent(new Event(type)));
const setAudio = (props: { currentTime?: number; duration?: number }) => {
  for (const [k, v] of Object.entries(props))
    Object.defineProperty(audio, k, { value: v, configurable: true, writable: true });
};
const audioPath = () => new URL(audio.src, "http://localhost").pathname;

beforeEach(() => {
  calls = [];
  server = {
    book: { ...BOOK },
    progress: { last: null, books: {} },
    job: null,
    audioProgress: { ready: 0, total: 2 },
    postNarrate: { ok: true },
  };
  vi.stubGlobal("fetch", mockFetch());
  localStorage.clear();
  installMediaStubs();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
});

describe("player: starting playback", () => {
  it("plays a narrated chapter straight away, without asking to narrate", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    expect(audioPath()).toBe("/api/audio/b1/0");
    expect(player.playing).toBe(true);
    expect(player.book?.title).toBe("Test Fic");
    expect(player.pendingNarration).toBeNull();
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/narrate"))).toBe(false);
  });

  it("resumes at the saved chapter and time", async () => {
    server.progress = {
      last: { id: "b1", chapter: 1, time: 42, updatedAt: 1 },
      books: { b1: { chapter: 1, time: 42, updatedAt: 1 } },
    };
    await mount();
    await act(async () => player.openBook("b1"));
    expect(player.chapter).toBe(1);
    expect(audioPath()).toBe("/api/audio/b1/1");
    expect(audio.currentTime).toBe(42);
  });

  it("opens a given chapter instead of the saved one", async () => {
    await mount();
    await act(async () => player.openBook("b1", { chapter: 1 }));
    expect(player.chapter).toBe(1);
    expect(audioPath()).toBe("/api/audio/b1/1");
  });

  it("toggles between playing and paused", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    await act(async () => player.togglePlay());
    expect(player.playing).toBe(false);
    await act(async () => player.togglePlay());
    expect(player.playing).toBe(true);
  });

  it("saves the position when paused", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    setAudio({ currentTime: 77 });
    await act(async () => player.togglePlay());
    const put = calls.filter((c) => c.method === "PUT" && c.url === "/api/progress").pop();
    expect(put?.body).toEqual({ id: "b1", chapter: 0, time: 77 });
    expect(JSON.parse(localStorage.getItem("abg:last")!)).toEqual({
      id: "b1",
      chapter: 0,
      time: 77,
    });
  });

  it("does not save a position before anything has played", async () => {
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("player: chapters that are not narrated yet", () => {
  it("asks before narrating, and does nothing until told", async () => {
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.playChapter(2));
    expect(player.pendingNarration).toMatchObject({ bookId: "b1", index: 2, title: "Three" });
    expect(calls.some((c) => c.url.includes("?prepare=1"))).toBe(false);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    await act(async () => player.cancelNarration());
    expect(player.pendingNarration).toBeNull();
  });

  it("narrates through the queue when confirmed, then plays when the audio exists", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.playChapter(2));
    await act(async () => player.confirmNarration());
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/books/b1/narrate");
    expect(post?.body).toEqual({ chapters: [2], onlyIfIdle: true });
    expect(player.preparing).toEqual({ chapter: 2, pct: 0 });

    server.audioProgress = { ready: 1, total: 2 };
    await act(async () => void (await vi.advanceTimersByTimeAsync(2100)));
    expect(player.preparing?.pct).toBe(50);
    expect(player.playing).toBe(false);

    server.audioProgress = { ready: 2, total: 2 };
    await act(async () => void (await vi.advanceTimersByTimeAsync(2100)));
    expect(player.preparing).toBeNull();
    expect(audioPath()).toBe("/api/audio/b1/2");
    expect(player.chapterState(2)).toBe("playing");
  });

  it("does not start over or cancel the job when the same chapter is played twice", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    localStorage.setItem("abg:confirm", "false");
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    // Neither call returns until the chapter is ready, so don't wait for them one by one.
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = Promise.resolve(player.playChapter(2));
      await vi.advanceTimersByTimeAsync(10);
      second = Promise.resolve(player.playChapter(2));
      await vi.advanceTimersByTimeAsync(10);
    });
    const posts = calls.filter((c) => c.method === "POST" && c.url === "/api/books/b1/narrate");
    expect(posts).toHaveLength(1);
    server.audioProgress = { ready: 2, total: 2 };
    await act(async () => void (await vi.advanceTimersByTimeAsync(2100)));
    await act(async () => void (await Promise.all([first, second])));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(audioPath()).toBe("/api/audio/b1/2");
  });

  it("narrates directly when the book already has a job running", async () => {
    server.postNarrate = { ok: false };
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.playChapter(2));
    await act(async () => player.confirmNarration());
    expect(calls.some((c) => c.url === "/api/audio/b1/2?prepare=1")).toBe(true);
    expect(audioPath()).toBe("/api/audio/b1/2");
  });

  it("skips the question when the setting is off", async () => {
    localStorage.setItem("abg:confirm", "false");
    server.postNarrate = { ok: false }; // narrate directly so the test doesn't wait on the queue
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.playChapter(2));
    expect(player.pendingNarration).toBeNull();
    expect(calls.some((c) => c.url === "/api/audio/b1/2?prepare=1")).toBe(true);
  });

  it("shows the error and marks the chapter failed when narrating fails", async () => {
    localStorage.setItem("abg:confirm", "false");
    server.postNarrate = { ok: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("?prepare=1")) return new Response("No OpenAI key", { status: 500 });
        return mockFetch()(input, init);
      }),
    );
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.playChapter(2));
    expect(player.error).toBe("No OpenAI key");
    expect(player.failedChapter).toBe(2);
    expect(player.chapterState(2)).toBe("failed");
  });
});

describe("player: keeping your place", () => {
  it("keeps playing the current chapter when another one is read ahead", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    localStorage.setItem("abg:confirm", "false");
    await mount();
    await act(async () => player.openBook("b1"));
    let ahead: Promise<void> = Promise.resolve();
    await act(async () => {
      ahead = Promise.resolve(player.playChapter(2));
      await vi.advanceTimersByTimeAsync(10);
    });
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/books/b1/narrate");
    expect(post?.body).toEqual({ chapters: [2], onlyIfIdle: true });
    expect(player.chapter).toBe(0);
    expect(audioPath()).toBe("/api/audio/b1/0");
    expect(player.playing).toBe(true);
    expect(player.preparing).toBeNull();
    expect(player.chapterState(2)).toBe("reading");

    server.audioProgress = { ready: 2, total: 2 };
    await act(async () => void (await vi.advanceTimersByTimeAsync(2100)));
    await act(async () => void (await ahead));
    expect(player.chapterState(2)).toBe("ready");
    expect(player.chapter).toBe(0);
    expect(audioPath()).toBe("/api/audio/b1/0");
  });

  it("comes back to a chapter where it was left", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    setAudio({ currentTime: 40 });
    await act(async () => player.playChapter(1));
    const puts = calls.filter((c) => c.method === "PUT" && c.url === "/api/progress");
    expect(puts.some((c) => JSON.stringify(c.body).includes('"chapter":0,"time":40'))).toBe(true);
    expect(audioPath()).toBe("/api/audio/b1/1");
    setAudio({ currentTime: 0 });
    await act(async () => player.playChapter(0));
    expect(audioPath()).toBe("/api/audio/b1/0");
    expect(audio.currentTime).toBe(40);
  });

  it("starts a finished chapter from the top again", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    await act(async () => player.playChapter(1));
    setAudio({ currentTime: 90 });
    await fire("ended");
    const puts = calls.filter((c) => c.method === "PUT" && c.url === "/api/progress");
    expect(puts.some((c) => (c.body as { clear?: number }).clear === 1)).toBe(true);
    // Chapter 1 is not started 90 s in: the element is left alone, so the stand-in time stays.
    setAudio({ currentTime: 99 });
    await act(async () => player.playChapter(1));
    expect(audio.currentTime).toBe(99);
  });
});

describe("player: auto-advance", () => {
  it("rolls into the next chapter when one ends, if it is narrated", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    await fire("ended");
    expect(player.chapter).toBe(1);
    expect(audioPath()).toBe("/api/audio/b1/1");
    expect(player.playing).toBe(true);
  });

  it("stops at the end of the book", async () => {
    server.book = { ...BOOK, narrated: [0, 1, 2] };
    await mount();
    await act(async () => player.openBook("b1", { chapter: 2 }));
    await fire("ended");
    expect(player.chapter).toBe(2);
    expect(player.playing).toBe(false);
  });

  it("stops rather than narrate the next chapter when auto-narrate is off", async () => {
    localStorage.setItem("abg:autonext", "false");
    await mount();
    await act(async () => player.openBook("b1", { chapter: 1 }));
    await fire("ended");
    expect(player.chapter).toBe(1);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/narrate"))).toBe(false);
  });

  it("stays inside the chosen range", async () => {
    server.book = { ...BOOK, narrated: [0, 1, 2] };
    await mount();
    await act(async () => player.openBook("b1", { chapter: 0, range: { from: 0, to: 0 } }));
    await fire("ended");
    // Chapter 1 is narrated so it still swaps (free); the range only limits what is narrated.
    expect(player.chapter).toBe(1);
  });

  it("does not treat the silent unlock clip ending as a finished chapter", async () => {
    localStorage.setItem("abg:confirm", "false");
    server.postNarrate = { ok: false };
    // Narrating chapter 2 takes a while: hold the request open so the silent clip is what is loaded.
    let finish: () => void = () => {};
    const inner = mockFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/audio/b1/2?prepare=1")
          await new Promise<void>((r) => (finish = r));
        return inner(input, init);
      }),
    );
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    let started: Promise<void> = Promise.resolve();
    await act(async () => {
      started = player.playChapter(2);
    });
    expect(audio.src.startsWith("data:")).toBe(true);
    await fire("ended");
    expect(player.chapter).toBe(2);
    expect(player.preparing).not.toBeNull();
    await act(async () => {
      finish();
      await started;
    });
    expect(audioPath()).toBe("/api/audio/b1/2");
  });
});

describe("player: sleep timer", () => {
  it("pauses when the minutes run out", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    const now = Date.now();
    await act(async () => player.setSleepMinutes(15));
    expect(player.sleep).toMatchObject({ kind: "minutes", minutes: 15 });
    setAudio({ currentTime: 10 });
    await fire("timeupdate");
    expect(player.playing).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(now + 16 * 60_000);
    await fire("timeupdate");
    expect(player.playing).toBe(false);
    expect(player.sleep).toEqual({ kind: "off" });
  });

  it("'end of chapter' stops after the chapter instead of advancing", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    await act(async () => player.setSleepMinutes(-1));
    await fire("ended");
    expect(player.chapter).toBe(0);
    expect(player.playing).toBe(false);
    expect(player.sleep).toEqual({ kind: "off" });
  });

  it("cycles off, 15, 30, 60, end of chapter, off", async () => {
    await mount();
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await act(async () => player.cycleSleep());
      seen.push(player.sleep.kind === "minutes" ? String(player.sleep.minutes) : player.sleep.kind);
    }
    expect(seen).toEqual(["15", "30", "60", "chapter", "off", "15"]);
  });

  it("starts the saved default sleep timer on a fresh listen", async () => {
    await mount();
    await act(async () => player.updateSettings({ sleep: 30 }));
    await act(async () => player.openBook("b1"));
    expect(player.sleep).toMatchObject({ kind: "minutes", minutes: 30 });
  });
});

describe("player: controls", () => {
  it("steps chapters and, like a CD player, restarts one that is past five seconds", async () => {
    await mount();
    await act(async () => player.openBook("b1", { chapter: 1 }));
    setAudio({ currentTime: 20 });
    await act(async () => player.prevChapter());
    expect(player.chapter).toBe(1);
    expect(audio.currentTime).toBe(0);
    setAudio({ currentTime: 2 });
    await act(async () => player.prevChapter());
    expect(player.chapter).toBe(0);
    await act(async () => player.nextChapter());
    expect(player.chapter).toBe(1);
  });

  it("skips forward and back, clamped to the chapter", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    setAudio({ currentTime: 100, duration: 110 });
    await act(async () => player.skip(15));
    expect(audio.currentTime).toBe(110);
    await act(async () => player.skip(-200));
    expect(audio.currentTime).toBe(0);
  });

  it("cycles the playback speed and applies it to the audio element", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    const before = player.rate;
    await act(async () => player.cycleRate());
    expect(player.rate).not.toBe(before);
    expect(audio.playbackRate).toBe(player.rate);
  });

  it("learns the narrator's pace from a long chapter's real duration", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    setAudio({ duration: 200 });
    await fire("loadedmetadata");
    expect(player.duration).toBe(200);
    expect(player.charsPerMin).toBe(900); // 3000 chars / (200 s / 60)
    expect(player.chapterMinutes(9000)).toBe(10);
  });
});

describe("player: lock screen", () => {
  it("sets the now-playing card and wires next/previous to the player", async () => {
    const handlers: Record<string, () => void> = {};
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        metadata: null,
        setActionHandler: (a: string, h: () => void) => void (handlers[a] = h),
      },
    });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: unknown) {}
      },
    );
    await mount();
    await act(async () => player.openBook("b1"));
    expect((navigator.mediaSession.metadata as unknown as { init: unknown }).init).toEqual({
      title: "One",
      artist: "Someone",
      album: "Test Fic",
    });
    await act(async () => handlers.nexttrack());
    expect(player.chapter).toBe(1);
    expect(Object.keys(handlers).sort()).toEqual([
      "nexttrack",
      "pause",
      "play",
      "previoustrack",
      "seekbackward",
      "seekforward",
    ]);
  });
});

describe("player: background narration job", () => {
  it("shows the job's status for the open book", async () => {
    server.job = { status: "running", chapter: 1, total: 3, updatedAt: Date.now() };
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await flush();
    expect(player.job).toMatchObject({ status: "running", chapter: 1 });
  });

  it("starts, pauses, resumes and stops the job", async () => {
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.startBackground({ from: 1, to: 2 }, "ballad"));
    expect(
      calls.find((c) => c.method === "POST" && c.url === "/api/books/b1/narrate")?.body,
    ).toEqual({ from: 1, to: 2, voice: "ballad" });
    expect(player.job?.status).toBe("running");
    await act(async () => player.pauseBackground());
    expect(player.job?.status).toBe("paused");
    await act(async () => player.resumeBackground());
    expect(player.job?.status).toBe("running");
    await act(async () => player.stopBackground());
    expect(player.job).toBeNull();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/books/b1/narrate")).toBe(
      true,
    );
  });

  it("reports a start failure instead of throwing", async () => {
    server.postNarrate = { ok: false };
    await mount();
    await act(async () => void (await player.selectBook("b1")));
    await act(async () => player.startBackground());
    expect(player.error).toBe("busy");
    expect(player.job).toBeNull();
  });
});

describe("player: library and settings", () => {
  it("clears the open book when it is removed", async () => {
    await mount();
    await act(async () => player.openBook("b1"));
    await act(async () => player.removeBook("b1"));
    expect(player.book).toBeNull();
    expect(player.playing).toBe(false);
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/books/b1")).toBe(true);
  });

  it("remembers auto-narrate and the confirm prompt on this device", async () => {
    await mount();
    await act(async () => player.setAutoNext(false));
    await act(async () => player.setConfirmNarrate(false));
    expect(localStorage.getItem("abg:autonext")).toBe("false");
    expect(localStorage.getItem("abg:confirm")).toBe("false");
  });
});
