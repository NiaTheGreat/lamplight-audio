import { describe, expect, it } from "vitest";
import { cookieSecure, workerOrigin } from "@/lib/self-host";

const req = new Request("https://books.example.com/api/books/x/narrate");

describe("workerOrigin", () => {
  it("uses the request's own address by default", () => {
    expect(workerOrigin(req, {})).toBe("https://books.example.com");
  });
  it("prefers WORKER_ORIGIN and drops a trailing slash", () => {
    expect(workerOrigin(req, { WORKER_ORIGIN: "http://127.0.0.1:3000/" })).toBe(
      "http://127.0.0.1:3000",
    );
  });
});

describe("cookieSecure", () => {
  it("is secure in production by default", () => {
    expect(cookieSecure({ NODE_ENV: "production" })).toBe(true);
    expect(cookieSecure({ NODE_ENV: "development" })).toBe(false);
  });
  it("can be switched off for plain http", () => {
    expect(cookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "false" })).toBe(false);
  });
});
