import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A tiny in-memory stand-in for the S3 API that R2 speaks (path-style: /<bucket>/<key>).
const objects = new Map<string, { body: Buffer; type: string; cache: string }>();
let failNext = 0;
let server: Server;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (failNext > 0) {
        failNext--;
        res.statusCode = 503;
        return res.end("busy");
      }
      const key = decodeURIComponent(url.pathname.replace(/^\/test-bucket\/?/, ""));
      if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        res.setHeader("Content-Type", "application/xml");
        return res.end(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`,
        );
      }
      if (req.method === "PUT") {
        // Like R2: an upload must declare its size up front (no chunked bodies).
        if (req.headers["content-length"] === undefined) {
          res.statusCode = 411;
          return res.end("<Error><Code>MissingContentLength</Code></Error>");
        }
        const body = Buffer.concat(chunks);
        if (Number(req.headers["content-length"]) !== body.length) {
          res.statusCode = 400;
          return res.end("size mismatch");
        }
        objects.set(key, {
          body,
          type: String(req.headers["content-type"]),
          cache: String(req.headers["cache-control"]),
        });
        return res.end();
      }
      const obj = objects.get(key);
      if (req.method === "DELETE") {
        objects.delete(key);
        res.statusCode = 204;
        return res.end();
      }
      if (!obj) {
        res.statusCode = 404;
        return res.end("<Error><Code>NoSuchKey</Code></Error>");
      }
      res.setHeader("Content-Length", obj.body.length);
      res.end(req.method === "HEAD" ? undefined : obj.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as { port: number };
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_ACCESS_KEY_ID = "key";
  process.env.R2_SECRET_ACCESS_KEY = "secret";
  process.env.R2_BUCKET = "test-bucket";
  process.env.R2_ENDPOINT = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  for (const k of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
  ]) {
    delete process.env[k];
  }
});

describe("R2 storage backend", () => {
  it("round-trips objects, reports missing ones, lists by prefix and deletes", async () => {
    const { putObject, getObject, hasObject, listKeys, deleteObject } =
      await import("@/lib/storage/storage");
    await putObject("library/aaaaaaaaaaaaaaaa.json", '{"a":1}', "application/json");
    await putObject("library/bbbbbbbbbbbbbbbb.json", "{}", "application/json");
    await putObject("books/cccccccccccccccc.json", "{}", "application/json");

    expect((await getObject("library/aaaaaaaaaaaaaaaa.json"))?.toString()).toBe('{"a":1}');
    expect(await getObject("library/missing.json")).toBeNull();
    expect(await hasObject("books/cccccccccccccccc.json")).toBe(true);
    expect(await hasObject("books/nope.json")).toBe(false);
    expect(await listKeys("library/")).toEqual([
      "library/aaaaaaaaaaaaaaaa.json",
      "library/bbbbbbbbbbbbbbbb.json",
    ]);

    await deleteObject("library/bbbbbbbbbbbbbbbb.json");
    expect(await listKeys("library/")).toEqual(["library/aaaaaaaaaaaaaaaa.json"]);
  });

  it("caches chapter audio only briefly (it can be rebuilt under the same name), previews for a year, records never", async () => {
    const { putObject } = await import("@/lib/storage/storage");
    await putObject("audio/abc.mp3", Buffer.from([1, 2, 3]), "audio/mpeg");
    await putObject("settings.json", "{}", "application/json");
    await putObject("previews/p.mp3", Buffer.from([4]), "audio/mpeg");
    expect(objects.get("audio/abc.mp3")?.cache).toBe("private, max-age=600");
    expect(objects.get("previews/p.mp3")?.cache).toContain("immutable");
    expect(objects.get("settings.json")?.cache).toBe("no-store");
    expect(objects.get("audio/abc.mp3")?.body).toEqual(Buffer.from([1, 2, 3]));
  });

  it("retries a busy storage server instead of treating it as missing", async () => {
    const { putObject, getObject } = await import("@/lib/storage/storage");
    await putObject("progress.json", "{}", "application/json");
    failNext = 2;
    expect((await getObject("progress.json"))?.toString()).toBe("{}");
  });

  it("hands out a signed address for the browser to upload a large file to", async () => {
    const { getUploadUrl } = await import("@/lib/storage/storage");
    const { newUploadKey, isUploadKey } = await import("@/lib/storage/uploads");
    const key = newUploadKey();
    expect(isUploadKey(key)).toBe(true);
    expect(isUploadKey("books/abc.json")).toBe(false);
    expect(isUploadKey("uploads/../secret.epub")).toBe(false);
    const url = await getUploadUrl(key);
    expect(url).toContain(key);
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=900");
  });

  it("hands out a signed, expiring address only for objects that exist", async () => {
    const { getPublicUrl } = await import("@/lib/storage/storage");
    const url = await getPublicUrl("audio/abc.mp3");
    expect(url).toContain("audio/abc.mp3");
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=3600");
    expect(await getPublicUrl("audio/nothing.mp3")).toBeNull();
  });
});
