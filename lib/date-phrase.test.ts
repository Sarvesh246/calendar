import { describe, expect, it } from "vitest";
import { matchDatePhrase } from "./date-phrase";

const NOW = new Date(2026, 8, 2); // 2 Sep 2026

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

describe("matchDatePhrase", () => {
  it("reads an abbreviated month with a trailing dot", () => {
    const m = matchDatePhrase("Sept. 11 Engineering Career Fair", NOW)!;
    expect(ymd(m.start)).toBe("2026-09-11");
    expect(m.end).toBeUndefined();
    expect(m.text).toBe("Sept. 11");
  });

  it("reads a day range within one month", () => {
    const m = matchDatePhrase("Sept. 9-10 Engineering Career Fair", NOW)!;
    expect(ymd(m.start)).toBe("2026-09-09");
    expect(ymd(m.end!)).toBe("2026-09-10");
  });

  it("reads a range that crosses months", () => {
    const m = matchDatePhrase("Sept 28 - Oct 2 reading days", NOW)!;
    expect(ymd(m.start)).toBe("2026-09-28");
    expect(ymd(m.end!)).toBe("2026-10-02");
  });

  it("rolls a range that crosses the new year", () => {
    const m = matchDatePhrase("Dec 30 - Jan 2 break", NOW)!;
    expect(ymd(m.start)).toBe("2026-12-30");
    expect(ymd(m.end!)).toBe("2027-01-02");
  });

  it("honours an explicit year", () => {
    const m = matchDatePhrase("March 3, 2028 thesis defense", NOW)!;
    expect(ymd(m.start)).toBe("2028-03-03");
  });

  it("reads ISO dates", () => {
    const m = matchDatePhrase("standup 2026-11-05", NOW)!;
    expect(ymd(m.start)).toBe("2026-11-05");
  });

  it("reads US numeric dates", () => {
    const m = matchDatePhrase("midterm 10/14", NOW)!;
    expect(ymd(m.start)).toBe("2026-10-14");
  });

  it("reads day-first phrasing", () => {
    const m = matchDatePhrase("9 September orientation", NOW)!;
    expect(ymd(m.start)).toBe("2026-09-09");
  });

  it("rolls to next year for a date well in the past", () => {
    const m = matchDatePhrase("Feb 3 registration", NOW)!;
    expect(ymd(m.start)).toBe("2027-02-03");
  });

  it("keeps a recently-passed date in the current year", () => {
    const m = matchDatePhrase("Aug 20 move-in", NOW)!;
    expect(ymd(m.start)).toBe("2026-08-20");
  });

  it("rejects an impossible day rather than rolling into the next month", () => {
    expect(matchDatePhrase("Feb 31 nonsense", NOW)).toBeNull();
  });

  it("ignores text with no date", () => {
    expect(matchDatePhrase("finish the lab report", NOW)).toBeNull();
  });

  it("does not read a time as a date", () => {
    expect(matchDatePhrase("standup at 9:30", NOW)).toBeNull();
  });
});
