import { describe, expect, it } from "vitest";
import {
  isJsonRequest,
  rateLimit,
  safeSecretEqual,
  sameOrigin,
  syllabusLimitKey,
  SYLLABUS_BURST,
} from "./api-guard";

describe("request guards", () => {
  it("accepts a same-origin browser request", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
    });
    expect(sameOrigin(request)).toBe(true);
  });

  it("rejects cross-site and mismatched-host requests", () => {
    const crossSite = new Request("http://localhost/api/test", {
      headers: { origin: "http://localhost", "sec-fetch-site": "cross-site" },
    });
    const foreign = new Request("http://localhost/api/test", {
      headers: { origin: "https://evil.example" },
    });
    expect(sameOrigin(crossSite)).toBe(false);
    expect(sameOrigin(foreign)).toBe(false);
  });

  it("rejects same-site requests from a different origin", () => {
    process.env.VERCEL_URL = "preview.example.test";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "datebook.example.test";
    const request = new Request("https://preview.example.test/api/test", {
      headers: { origin: "https://datebook.example.test", "sec-fetch-site": "same-site" },
    });
    expect(sameOrigin(request)).toBe(false);
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  it("requires JSON content types where requested", () => {
    expect(isJsonRequest(new Request("http://localhost", { headers: { "content-type": "application/json; charset=utf-8" } }))).toBe(true);
    expect(isJsonRequest(new Request("http://localhost", { headers: { "content-type": "text/plain" } }))).toBe(false);
  });

  it("compares webhook secrets without accepting prefixes", () => {
    expect(safeSecretEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeSecretEqual("Bearer ab", "Bearer abc")).toBe(false);
  });
});

describe("syllabusLimitKey", () => {
  it("keys signed-in users by id and anonymous callers by IP", () => {
    expect(syllabusLimitKey({ id: "user-a" }, "10.0.0.1")).toBe("syllabus:user:user-a");
    expect(syllabusLimitKey({ id: "user-b" }, "10.0.0.1")).toBe("syllabus:user:user-b");
    expect(syllabusLimitKey(null, "10.0.0.1")).toBe("syllabus:ip:10.0.0.1");
    expect(syllabusLimitKey(null, "10.0.0.2")).toBe("syllabus:ip:10.0.0.2");
  });
});

describe("rateLimit isolation", () => {
  it("does not let one user's burst starve another user on the same IP", () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const a = `${syllabusLimitKey({ id: `u-a-${suffix}` }, "10.1.1.1")}:burst`;
    const b = `${syllabusLimitKey({ id: `u-b-${suffix}` }, "10.1.1.1")}:burst`;
    for (let i = 0; i < SYLLABUS_BURST; i++) {
      expect(rateLimit(a, SYLLABUS_BURST, 60_000)).toBe(true);
    }
    expect(rateLimit(a, SYLLABUS_BURST, 60_000)).toBe(false);
    expect(rateLimit(b, SYLLABUS_BURST, 60_000)).toBe(true);
  });

  it("allows at least two concurrent-style hits in the burst window", () => {
    const key = `syllabus:user:burst-check-${Date.now()}-${Math.random()}:burst`;
    expect(SYLLABUS_BURST).toBeGreaterThanOrEqual(8);
    expect(rateLimit(key, SYLLABUS_BURST, 60_000)).toBe(true);
    expect(rateLimit(key, SYLLABUS_BURST, 60_000)).toBe(true);
  });
});
