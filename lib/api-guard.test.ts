import { describe, expect, it } from "vitest";
import { guestBucketKey, ipCeiling, rateLimit, syllabusLimitKey, SYLLABUS_BURST } from "./api-guard";

describe("syllabusLimitKey", () => {
  it("keys signed-in users by id and anonymous callers by IP", () => {
    expect(syllabusLimitKey({ id: "user-a" }, "10.0.0.1")).toBe("syllabus:user:user-a");
    expect(syllabusLimitKey({ id: "user-b" }, "10.0.0.1")).toBe("syllabus:user:user-b");
    expect(syllabusLimitKey(null, "10.0.0.1")).toBe("syllabus:ip:10.0.0.1");
    expect(syllabusLimitKey(null, "10.0.0.2")).toBe("syllabus:ip:10.0.0.2");
  });
});

describe("guestBucketKey", () => {
  const req = (clientId?: string) =>
    new Request("https://example.com", {
      headers: clientId ? { "x-client-id": clientId } : {},
    });

  it("folds a well-formed client id into the IP so two guests on one IP don't share a bucket", () => {
    const a = guestBucketKey(req("11111111-aaaa-bbbb-cccc-111111111111"), "10.0.0.1");
    const b = guestBucketKey(req("22222222-aaaa-bbbb-cccc-222222222222"), "10.0.0.1");
    expect(a).not.toBe(b);
    expect(a).toBe("10.0.0.1:11111111-aaaa-bbbb-cccc-111111111111");
  });

  it("falls back to the bare IP when the header is missing or malformed", () => {
    expect(guestBucketKey(req(), "10.0.0.1")).toBe("10.0.0.1");
    expect(guestBucketKey(req("short"), "10.0.0.1")).toBe("10.0.0.1");
    expect(guestBucketKey(req("has spaces not allowed"), "10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("ipCeiling", () => {
  it("caps the total across every guest bucket sharing one IP", () => {
    const ip = `10.2.2.${Date.now() % 255}`;
    for (let i = 0; i < 5; i++) {
      expect(ipCeiling("test-prefix", ip, 5, 60_000)).toBe(true);
    }
    expect(ipCeiling("test-prefix", ip, 5, 60_000)).toBe(false);
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
