import { describe, expect, it } from "vitest";
import { serveBytes } from "@/lib/narration/http";

const data = Buffer.from("0123456789");
const req = (range?: string) =>
  new Request("http://x/audio", { headers: range ? { Range: range } : {} });

describe("serveBytes", () => {
  it("serves the whole file with Accept-Ranges", async () => {
    const res = serveBytes(req(), data, "audio/mpeg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123456789");
  });

  it("handles a closed range", async () => {
    const res = serveBytes(req("bytes=2-4"), data, "audio/mpeg");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-4/10");
    expect(await res.text()).toBe("234");
  });

  it("handles open-ended and suffix ranges", async () => {
    const open = serveBytes(req("bytes=7-"), data, "audio/mpeg");
    expect(await open.text()).toBe("789");
    const suffix = serveBytes(req("bytes=-3"), data, "audio/mpeg");
    expect(await suffix.text()).toBe("789");
  });

  it("handles the one-byte warm-up request", async () => {
    const res = serveBytes(req("bytes=0-0"), data, "audio/mpeg");
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("0");
  });

  it("rejects ranges past the end", () => {
    expect(serveBytes(req("bytes=50-60"), data, "audio/mpeg").status).toBe(416);
  });

  it("sets a download filename when asked", () => {
    const res = serveBytes(req(), data, "audio/mpeg", { filename: "My Fic - 01.mp3" });
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
});
