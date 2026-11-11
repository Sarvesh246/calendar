import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateLookupLine, fixWeekdays, weekdayStamp } from "./assistant-dates";
import { checkAvailability } from "./availability";

// Tuesday, Nov 10 2026, evening in New York.
const NOW = "2026-11-10T23:30:00.000Z";
const NY = "America/New_York";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => vi.useRealTimers());

describe("weekdayStamp", () => {
  it("puts the weekday on the stamp", () => {
    expect(weekdayStamp("2026-11-12T20:00:00.000Z", NY)).toBe("Thu 2026-11-12 15:00");
  });

  it("is the weekday in the user's zone, not UTC's", () => {
    // 01:00 UTC on the 13th is still Thursday evening in New York.
    expect(weekdayStamp("2026-11-13T01:00:00.000Z", NY)).toBe("Thu 2026-11-12 20:00");
    expect(weekdayStamp("2026-11-13T01:00:00.000Z", "UTC")).toBe("Fri 2026-11-13 01:00");
  });

  it("copes with nothing and with a bad zone", () => {
    expect(weekdayStamp(undefined, NY)).toBe("");
    expect(weekdayStamp("nonsense", NY)).toBe("");
    expect(weekdayStamp("2026-11-12T20:00:00.000Z", "Not/AZone")).toBe("2026-11-12 20:00");
  });
});

describe("dateLookupLine", () => {
  it("lists the next 14 days with today and tomorrow marked", () => {
    const line = dateLookupLine(NOW, NY);
    const parts = line.split(", ");
    expect(parts).toHaveLength(14);
    expect(parts[0]).toBe("Tue Nov 10 (today)");
    expect(parts[1]).toBe("Wed Nov 11 (tomorrow)");
    expect(parts[2]).toBe("Thu Nov 12");
    expect(parts[13]).toBe("Mon Nov 23");
  });

  it("starts from the user's today, not UTC's", () => {
    // 03:00 UTC on the 11th is still the 10th in New York.
    expect(dateLookupLine("2026-11-11T03:00:00.000Z", NY).startsWith("Tue Nov 10 (today)")).toBe(
      true,
    );
  });

  it("crosses a month and a year", () => {
    const parts = dateLookupLine("2026-12-30T12:00:00.000Z", "UTC", 4).split(", ");
    expect(parts).toEqual([
      "Wed Dec 30 (today)",
      "Thu Dec 31 (tomorrow)",
      "Fri Jan 1",
      "Sat Jan 2",
    ]);
  });
});

describe("fixWeekdays", () => {
  const fix = (text: string) => fixWeekdays(text, NOW, NY);

  it("repairs the audit's wrong date: Thursday, November 13 is a Friday", () => {
    expect(fix("Yes, you are free at 7:00 PM on Thursday, November 13.")).toBe(
      "Yes, you are free at 7:00 PM on Friday, November 13.",
    );
  });

  it("leaves a correct pair alone", () => {
    const text = "Your study group is Thursday, November 12 at 7 PM.";
    expect(fix(text)).toBe(text);
  });

  it("keeps abbreviations and ordinals as written", () => {
    expect(fix("Due Wed, Nov 12th.")).toBe("Due Thu, Nov 12th.");
    expect(fix("Due Wed Nov 12")).toBe("Due Thu Nov 12");
  });

  it("fixes every pair in a list", () => {
    const fixed = fix("- Essay: Thursday, Nov 13\n- Lab: Friday, Nov 13\n- Quiz: Mon, Nov 16");
    expect(fixed).toBe("- Essay: Friday, Nov 13\n- Lab: Friday, Nov 13\n- Quiz: Mon, Nov 16");
  });

  it("picks the year nearest today, across New Year", () => {
    // Jan 1 2027 is a Friday; asked on Dec 30 2026.
    const text = fixWeekdays("Saturday, January 1", "2026-12-30T12:00:00.000Z", "UTC");
    expect(text).toBe("Friday, January 1");
  });

  it("ignores text without a date pair, and impossible dates", () => {
    expect(fix("Nothing due on Friday.")).toBe("Nothing due on Friday.");
    expect(fix("It is May 5 and Monday.")).toBe("It is May 5 and Monday.");
  });
});

describe("checkAvailability", () => {
  // The audit's case: a 19:00 Thursday event, then "am I free thursday at 7pm?"
  const study = {
    id: "s",
    title: "Study group meeting",
    type: "event",
    at: "2026-11-13T00:00:00.000Z", // Thu 19:00 New York
  };
  const lab = {
    id: "l",
    title: "Lab report",
    type: "assignment",
    at: "2026-11-13T04:59:00.000Z",
  };

  it("is not free when a timed event sits on the window", () => {
    const r = checkAvailability(
      [study, lab],
      "2026-11-13T00:00:00.000Z",
      "2026-11-13T00:00:00.000Z",
      NY,
    );
    expect(r.free).toBe(false);
    expect(r.conflicts).toEqual([
      { id: "s", title: "Study group meeting", start: "Thu 2026-11-12 19:00" },
    ]);
  });

  it("is free just after an event with no end has run its hour", () => {
    expect(
      checkAvailability([study], "2026-11-13T01:00:00.000Z", "2026-11-13T02:00:00.000Z", NY).free,
    ).toBe(true);
  });

  it("an event ending at the window start does not conflict", () => {
    const meeting = { ...study, endAt: "2026-11-13T01:00:00.000Z" };
    expect(
      checkAvailability([meeting], "2026-11-13T01:00:00.000Z", "2026-11-13T02:00:00.000Z", NY).free,
    ).toBe(true);
    expect(
      checkAvailability([meeting], "2026-11-13T00:59:00.000Z", "2026-11-13T02:00:00.000Z", NY).free,
    ).toBe(false);
  });

  it("assignments never make you busy; all-day events are noted but do not block", () => {
    const holiday = {
      id: "h",
      title: "Veterans Day",
      type: "event",
      at: "2026-11-11T05:00:00.000Z",
      allDay: true,
    };
    const r = checkAvailability(
      [lab, holiday],
      "2026-11-11T15:00:00.000Z",
      "2026-11-11T16:00:00.000Z",
      NY,
    );
    expect(r.free).toBe(true);
    expect(r.allDay.map((c) => c.title)).toEqual(["Veterans Day"]);
  });

  it("reports several conflicts in time order", () => {
    const a = {
      id: "a",
      title: "A",
      type: "event",
      at: "2026-11-13T00:30:00.000Z",
      endAt: "2026-11-13T01:30:00.000Z",
    };
    const r = checkAvailability(
      [a, study],
      "2026-11-13T00:00:00.000Z",
      "2026-11-13T02:00:00.000Z",
      NY,
    );
    expect(r.conflicts.map((c) => c.id)).toEqual(["s", "a"]);
  });

  it("a bad window is free rather than an error", () => {
    expect(checkAvailability([study], "nope", "2026-11-13T00:00:00.000Z", NY).free).toBe(true);
  });
});
