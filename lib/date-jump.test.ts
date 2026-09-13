import { describe, expect, it } from "vitest";
import { parseJumpDate } from "./date-jump";

const NOW = new Date(2026, 8, 16, 15, 0); // Wed, Sep 16 2026
const ymd = (d: Date | null) => (d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null);

describe("parseJumpDate", () => {
  it("reads relative words", () => {
    expect(ymd(parseJumpDate("today", NOW))).toEqual([2026, 9, 16]);
    expect(ymd(parseJumpDate("Tomorrow", NOW))).toEqual([2026, 9, 17]);
    expect(ymd(parseJumpDate("in 3 weeks", NOW))).toEqual([2026, 10, 7]);
    expect(ymd(parseJumpDate("next month", NOW))).toEqual([2026, 10, 16]);
  });

  it("reads weekdays", () => {
    expect(ymd(parseJumpDate("friday", NOW))).toEqual([2026, 9, 18]);
    expect(ymd(parseJumpDate("wed", NOW))).toEqual([2026, 9, 16]);
    expect(ymd(parseJumpDate("next wednesday", NOW))).toEqual([2026, 9, 23]);
  });

  it("reads written dates", () => {
    expect(ymd(parseJumpDate("Dec 12", NOW))).toEqual([2026, 12, 12]);
    expect(ymd(parseJumpDate("12 December 2027", NOW))).toEqual([2027, 12, 12]);
    expect(ymd(parseJumpDate("December 7th, 2026", NOW))).toEqual([2026, 12, 7]);
    expect(ymd(parseJumpDate("12/25", NOW))).toEqual([2026, 12, 25]);
    expect(ymd(parseJumpDate("1/15/27", NOW))).toEqual([2027, 1, 15]);
    expect(ymd(parseJumpDate("2027-01-15", NOW))).toEqual([2027, 1, 15]);
  });

  it("opens a bare month on its first day", () => {
    expect(ymd(parseJumpDate("january 2027", NOW))).toEqual([2027, 1, 1]);
    expect(ymd(parseJumpDate("may", NOW))).toEqual([2026, 5, 1]);
  });

  it("rejects things that aren't dates", () => {
    expect(parseJumpDate("", NOW)).toBeNull();
    expect(parseJumpDate("finals", NOW)).toBeNull();
    expect(parseJumpDate("2/30", NOW)).toBeNull();
  });
});
