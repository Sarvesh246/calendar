import { describe, expect, it } from "vitest";
import {
  classCountdownLabel,
  eventRemainingLabel,
  formatDaySummary,
  formatRemainingLabel,
  happeningNow,
  happeningNowStack,
  isClassStartingSoon,
  isHappeningNow,
  isOverdue,
  itemDaySpan,
  itemOccupiesDay,
  nextOpenAssignment,
  openItemsOnDay,
  wallTimeInZoneToIso,
  weekWorkload,
} from "./date-utils";
import type { Item } from "./types";

const base = (over: Partial<Item> = {}): Item => ({
  id: "1",
  categoryId: "c",
  type: "assignment",
  title: "Essay",
  at: new Date("2026-08-20T23:59:00").toISOString(),
  createdAt: new Date().toISOString(),
  status: "todo",
  ...over,
});

describe("isOverdue", () => {
  it("ignores events and completed work", () => {
    expect(isOverdue(base({ type: "event", status: undefined }))).toBe(false);
    expect(isOverdue(base({ status: "done" }))).toBe(false);
  });

  it("flags past open assignments", () => {
    expect(isOverdue(base({ at: new Date(Date.now() - 60_000).toISOString() }))).toBe(true);
  });

  it("does not flag all-day work that is still today", () => {
    const todayNoon = new Date();
    todayNoon.setHours(12, 0, 0, 0);
    expect(isOverdue(base({ at: todayNoon.toISOString(), allDay: true }))).toBe(false);
  });
});

describe("itemDaySpan", () => {
  it("treats exclusive midnight end as the previous day", () => {
    const item = base({
      type: "event",
      at: "2026-09-01T15:00:00.000Z",
      endAt: "2026-09-02T00:00:00.000Z",
    });
    const { start, last } = itemDaySpan(item);
    expect(last.getTime()).toBe(start.getTime());
  });
});

describe("itemOccupiesDay", () => {
  it("includes the start day", () => {
    const item = base({ at: new Date("2026-09-01T18:00:00").toISOString() });
    expect(itemOccupiesDay(item, new Date("2026-09-01T08:00:00"))).toBe(true);
    expect(itemOccupiesDay(item, new Date("2026-09-02T08:00:00"))).toBe(false);
  });
});

describe("wallTimeInZoneToIso", () => {
  it("builds an instant whose wall clock in the zone matches", () => {
    const iso = wallTimeInZoneToIso("2026-08-28", 23, 59, "America/Chicago");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    expect(hour === "23" || hour === "11").toBe(true);
    expect(minute).toBe("59");
  });
});

describe("weekWorkload", () => {
  it("returns 7 days", () => {
    const days = weekWorkload([], new Date("2026-08-28T12:00:00"), 0);
    expect(days).toHaveLength(7);
  });
});

describe("nextOpenAssignment", () => {
  it("skips events and completed work, then returns the soonest due", () => {
    const later = base({ id: "2", at: new Date("2026-09-02T12:00:00").toISOString() });
    const sooner = base({ id: "3", at: new Date("2026-09-01T12:00:00").toISOString() });
    const done = base({ id: "4", status: "done", at: new Date("2026-08-01T12:00:00").toISOString() });
    const event = base({ id: "5", type: "event", at: new Date("2026-08-15T12:00:00").toISOString() });
    expect(nextOpenAssignment([later, sooner, done, event])?.id).toBe("3");
  });
});

describe("openItemsOnDay", () => {
  it("keeps events and unfinished work", () => {
    const event = base({ id: "e", type: "event", status: undefined });
    const done = base({ id: "d", status: "done" });
    const open = base({ id: "o", status: "todo" });
    expect(openItemsOnDay([event, done, open]).map((i) => i.id)).toEqual(["e", "o"]);
  });
});

describe("formatDaySummary", () => {
  it("joins the counts that matter and stays quiet when empty", () => {
    expect(formatDaySummary(0, 0, 0)).toBe("Clear day");
    expect(formatDaySummary(1, 0, 0)).toBe("1 event");
    expect(formatDaySummary(2, 1, 1)).toBe("1 overdue · 2 events · 1 due");
  });
});

describe("formatRemainingLabel", () => {
  const minutes = (n: number) => n * 60_000;

  it("uses minutes only under an hour", () => {
    expect(formatRemainingLabel(minutes(1))).toBe("1 min left");
    expect(formatRemainingLabel(minutes(12))).toBe("12 min left");
    expect(formatRemainingLabel(minutes(59))).toBe("59 min left");
  });

  it("rounds sub-minute leftovers up to at least a minute", () => {
    expect(formatRemainingLabel(1)).toBe("1 min left");
    expect(formatRemainingLabel(30_000)).toBe("1 min left");
  });

  it("uses hours and minutes under a day", () => {
    expect(formatRemainingLabel(minutes(60))).toBe("1 hr left");
    expect(formatRemainingLabel(minutes(61))).toBe("1 hr 1 min left");
    expect(formatRemainingLabel(minutes(5 * 60 + 12))).toBe("5 hr 12 min left");
    expect(formatRemainingLabel(minutes(23 * 60 + 59))).toBe("23 hr 59 min left");
  });

  it("uses days and hours when a day or more remains", () => {
    expect(formatRemainingLabel(minutes(24 * 60))).toBe("1 day left");
    expect(formatRemainingLabel(minutes(24 * 60 + 60))).toBe("1 day 1 hr left");
    // Career fair: 1672 minutes = 1 day 3 hr 52 min → drop minutes at day scale.
    expect(formatRemainingLabel(minutes(1672))).toBe("1 day 3 hr left");
    expect(formatRemainingLabel(minutes(2 * 24 * 60))).toBe("2 days left");
    expect(formatRemainingLabel(minutes(2 * 24 * 60 + 5 * 60))).toBe("2 days 5 hr left");
  });
});

describe("eventRemainingLabel", () => {
  const now = new Date("2026-09-09T12:00:00");

  it("is silent when the event is not happening", () => {
    expect(
      eventRemainingLabel(
        base({
          type: "event",
          at: "2026-09-09T13:00:00",
          endAt: "2026-09-09T14:00:00",
        }),
        now
      )
    ).toBeUndefined();
    expect(
      eventRemainingLabel(
        base({
          type: "event",
          at: "2026-09-09T10:00:00",
          endAt: "2026-09-09T11:00:00",
        }),
        now
      )
    ).toBeUndefined();
    expect(eventRemainingLabel(base({ type: "assignment" }), now)).toBeUndefined();
  });

  it("labels an event in progress", () => {
    expect(
      eventRemainingLabel(
        base({
          type: "event",
          at: "2026-09-09T11:48:00",
          endAt: "2026-09-09T12:12:00",
        }),
        now
      )
    ).toBe("12 min left");
  });

  it("uses today's session end for a multi-day 9-to-5, not the final night", () => {
    expect(
      eventRemainingLabel(
        base({
          type: "event",
          title: "Career fair",
          at: "2026-09-08T09:00:00",
          endAt: "2026-09-10T17:00:00",
        }),
        now
      )
    ).toBe("5 hr left");
  });
});

describe("isHappeningNow", () => {
  const evening = new Date("2026-09-09T19:37:00");

  it("does not treat tomorrow's 9–5 as happening tonight", () => {
    const fair = base({
      type: "event",
      title: "Career fair",
      at: "2026-09-10T09:00:00",
      endAt: "2026-09-10T17:00:00",
    });
    expect(isHappeningNow(fair, evening)).toBe(false);
    expect(eventRemainingLabel(fair, evening)).toBeUndefined();
    expect(happeningNow([fair], evening)).toHaveLength(0);
  });

  it("does not stay live after 5pm on a 9–5 that was saved across midnight", () => {
    const fair = base({
      type: "event",
      title: "Career fair",
      at: "2026-09-09T09:00:00",
      endAt: "2026-09-10T17:00:00",
    });
    expect(isHappeningNow(fair, evening)).toBe(false);
    expect(eventRemainingLabel(fair, evening)).toBeUndefined();
  });

  it("is live during today's 9–5 window", () => {
    const fair = base({
      type: "event",
      title: "Career fair",
      at: "2026-09-09T09:00:00",
      endAt: "2026-09-09T17:00:00",
    });
    expect(isHappeningNow(fair, new Date("2026-09-09T12:00:00"))).toBe(true);
    expect(isHappeningNow(fair, evening)).toBe(false);
  });

  it("keeps an overnight flight live through the night", () => {
    const flight = base({
      type: "event",
      title: "Red-eye",
      at: "2026-09-09T22:00:00",
      endAt: "2026-09-10T06:00:00",
    });
    expect(isHappeningNow(flight, new Date("2026-09-09T23:00:00"))).toBe(true);
    expect(isHappeningNow(flight, new Date("2026-09-10T03:00:00"))).toBe(true);
    expect(isHappeningNow(flight, new Date("2026-09-10T07:00:00"))).toBe(false);
  });
});

describe("class countdown and happening-now stack", () => {
  const lecture = (over: Partial<Item> = {}): Item => ({
    id: "class-1",
    categoryId: "pols",
    type: "event",
    title: "POLS 207",
    at: new Date(2026, 8, 11, 10, 20).toISOString(),
    endAt: new Date(2026, 8, 11, 11, 10).toISOString(),
    createdAt: new Date(2026, 8, 11).toISOString(),
    repeat: { freq: "weekly", byDay: [1, 3, 5] },
    repeatId: "s1",
    ...over,
  });

  it("counts down only inside the last 10 minutes", () => {
    const item = lecture();
    expect(isClassStartingSoon(item, new Date(2026, 8, 11, 10, 5))).toBe(false);
    expect(isClassStartingSoon(item, new Date(2026, 8, 11, 10, 12))).toBe(true);
    expect(isClassStartingSoon(item, new Date(2026, 8, 11, 10, 20))).toBe(false);
    expect(isClassStartingSoon(item, new Date(2026, 8, 11, 10, 30))).toBe(false);
  });

  it("does not countdown a Canvas feed event", () => {
    const item = lecture({ sourceId: "feed" });
    expect(isClassStartingSoon(item, new Date(2026, 8, 11, 10, 12))).toBe(false);
  });

  it("puts an in-session class on the live stack and a soon class on countdown", () => {
    const live = lecture({
      id: "live",
      at: new Date(2026, 8, 11, 9, 10).toISOString(),
      endAt: new Date(2026, 8, 11, 10, 20).toISOString(),
    });
    const soon = lecture({ id: "soon" });
    const later = lecture({
      id: "later",
      at: new Date(2026, 8, 11, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 11, 14, 50).toISOString(),
    });
    const office = base({
      id: "office",
      type: "event",
      title: "Office hours",
      at: new Date(2026, 8, 11, 16, 0).toISOString(),
      endAt: new Date(2026, 8, 11, 17, 0).toISOString(),
    });
    const now = new Date(2026, 8, 11, 10, 12);
    const stack = happeningNowStack([live, soon, later, office], now);
    expect(stack.happening.map((i) => i.id)).toEqual(["live"]);
    expect(stack.startingSoon.map((i) => i.id)).toEqual(["soon"]);
    expect(stack.upcoming?.id).toBe("office");
  });

  it("labels a countdown in minutes or seconds", () => {
    const start = new Date(2026, 8, 11, 10, 20);
    expect(classCountdownLabel(start, new Date(2026, 8, 11, 10, 12))).toBe("8 min");
    expect(classCountdownLabel(start, new Date(2026, 8, 11, 10, 19, 20))).toBe("40 sec");
    expect(classCountdownLabel(start, new Date(2026, 8, 11, 10, 20))).toBe("Starting now");
  });
});
