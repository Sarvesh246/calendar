import { describe, expect, it } from "vitest";
import { expandRepeat, nthWeekdayLabel, nthWeekdayRuleFor, repeatLabel } from "./repeat";

const local = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h, 0, 0).toISOString();
const days = (occ: { at: string }[]) => occ.map((o) => new Date(o.at).getDate());
const months = (occ: { at: string }[]) => occ.map((o) => new Date(o.at).getMonth() + 1);

describe("yearly repeat", () => {
  it("repeats on the same date each year, for five years by default", () => {
    const occ = expandRepeat(local(2026, 3, 14), undefined, { freq: "yearly" });
    expect(occ.map((o) => new Date(o.at).getFullYear())).toEqual([
      2026, 2027, 2028, 2029, 2030, 2031,
    ]);
    expect(new Set(days(occ))).toEqual(new Set([14]));
  });

  it("clamps Feb 29 in common years and returns to it in leap years", () => {
    const occ = expandRepeat(local(2028, 2, 29), undefined, {
      freq: "yearly",
      until: local(2032, 3, 1),
    });
    expect(days(occ)).toEqual([29, 28, 28, 28, 29]);
  });

  it("honours an interval", () => {
    const occ = expandRepeat(local(2026, 1, 5), undefined, {
      freq: "yearly",
      interval: 2,
      until: local(2031, 1, 5),
    });
    expect(occ.map((o) => new Date(o.at).getFullYear())).toEqual([2026, 2028, 2030]);
  });

  it("labels", () => {
    expect(repeatLabel({ freq: "yearly" })).toBe("Every year");
    expect(repeatLabel({ freq: "yearly", interval: 2 })).toBe("Every 2 years");
  });
});

describe("nth weekday of the month", () => {
  it("first Monday of every month", () => {
    // Sep 7 2026 is the first Monday of September.
    const occ = expandRepeat(local(2026, 9, 7), undefined, {
      freq: "monthly",
      byDay: [1],
      bySetPos: 1,
      until: local(2026, 12, 31),
    });
    expect(months(occ)).toEqual([9, 10, 11, 12]);
    expect(days(occ)).toEqual([7, 5, 2, 7]);
    expect(occ.every((o) => new Date(o.at).getDay() === 1)).toBe(true);
  });

  it("last Friday handles months of different lengths", () => {
    const occ = expandRepeat(local(2026, 1, 30), undefined, {
      freq: "monthly",
      byDay: [5],
      bySetPos: -1,
      until: local(2026, 4, 30),
    });
    expect(days(occ)).toEqual([30, 27, 27, 24]);
  });

  it("starts at the next match when the start date is not one", () => {
    // Sep 1 2026 is a Tuesday; the first Monday is Sep 7.
    const occ = expandRepeat(local(2026, 9, 1), undefined, {
      freq: "monthly",
      byDay: [1],
      bySetPos: 1,
      until: local(2026, 10, 31),
    });
    expect(days(occ)).toEqual([7, 5]);
  });

  it("keeps time of day and duration", () => {
    const occ = expandRepeat(local(2026, 9, 7, 9), local(2026, 9, 7, 10), {
      freq: "monthly",
      byDay: [1],
      bySetPos: 1,
      until: local(2026, 11, 30),
    });
    expect(new Date(occ[1].at).getHours()).toBe(9);
    expect(+new Date(occ[1].endAt!) - +new Date(occ[1].at)).toBe(3_600_000);
  });

  it("derives the rule a date satisfies, treating the 5th as the last", () => {
    expect(nthWeekdayRuleFor(new Date(2026, 8, 7))).toEqual({ byDay: [1], bySetPos: 1 });
    expect(nthWeekdayRuleFor(new Date(2026, 8, 30))).toEqual({ byDay: [3], bySetPos: -1 });
    expect(nthWeekdayRuleFor(new Date(2026, 8, 15))).toEqual({ byDay: [2], bySetPos: 3 });
  });

  it("labels", () => {
    const rule = { freq: "monthly" as const, byDay: [1], bySetPos: 1 };
    expect(nthWeekdayLabel(rule)).toBe("first Monday");
    expect(repeatLabel(rule)).toBe("Monthly · first Monday");
    expect(repeatLabel({ ...rule, bySetPos: -1, interval: 2 })).toBe(
      "Every 2 months · last Monday",
    );
  });
});
