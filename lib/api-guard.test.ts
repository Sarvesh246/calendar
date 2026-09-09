import { describe, expect, it } from "vitest";
import { rateLimit, syllabusLimitKey, SYLLABUS_BURST } from "./api-guard";

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
