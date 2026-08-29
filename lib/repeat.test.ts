import { describe, expect, it } from "vitest";
import { expandRepeat, repeatLabel } from "./repeat";

describe("expandRepeat", () => {
  it("expands daily occurrences", () => {
    const occ = expandRepeat("2026-09-01T12:00:00.000Z", undefined, {
      freq: "daily",
      until: "2026-09-04T12:00:00.000Z",
    });
    expect(occ.length).toBeGreaterThanOrEqual(3);
    expect(occ[0].at).toBe("2026-09-01T12:00:00.000Z");
  });

  it("keeps duration on later instances", () => {
    const occ = expandRepeat(
      "2026-09-01T15:00:00.000Z",
      "2026-09-01T16:00:00.000Z",
      { freq: "weekly", until: "2026-09-16T00:00:00.000Z" }
    );
    expect(occ.length).toBeGreaterThanOrEqual(2);
    const span = +new Date(occ[1].endAt!) - +new Date(occ[1].at);
    expect(span).toBe(60 * 60 * 1000);
  });

  it("labels weekly by day", () => {
    expect(repeatLabel({ freq: "weekly", byDay: [2, 4] })).toContain("Tue");
  });
});
