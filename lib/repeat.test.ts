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

describe("monthly anchoring", () => {
  const local = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m - 1, d, h, 0, 0).toISOString();
  const days = (occ: { at: string }[]) => occ.map((o) => new Date(o.at).getDate());

  it("keeps a series on the 31st instead of drifting to February's clamp", () => {
    const occ = expandRepeat(local(2026, 1, 31), undefined, {
      freq: "monthly",
      until: local(2026, 6, 1),
    });
    // Jan 31 → Feb 28 (clamped) → Mar 31 → Apr 30 → May 31: the clamp must not
    // carry forward into the months that do have a 31st.
    expect(days(occ)).toEqual([31, 28, 31, 30, 31]);
  });

  it("clamps to Feb 29 in a leap year", () => {
    const occ = expandRepeat(local(2028, 1, 31), undefined, {
      freq: "monthly",
      until: local(2028, 4, 1),
    });
    expect(days(occ)).toEqual([31, 29, 31]);
  });

  it("anchors each step from the start when interval > 1", () => {
    const occ = expandRepeat(local(2026, 1, 31), undefined, {
      freq: "monthly",
      interval: 2,
      until: local(2026, 10, 1),
    });
    // Jan, Mar, May, Jul, Sep — September has 30 days.
    expect(days(occ)).toEqual([31, 31, 31, 31, 30]);
  });

  it("preserves the time of day across a clamped month", () => {
    const occ = expandRepeat(local(2026, 1, 31, 9), undefined, {
      freq: "monthly",
      until: local(2026, 4, 1),
    });
    expect(occ.map((o) => new Date(o.at).getHours())).toEqual([9, 9, 9]);
  });
});
