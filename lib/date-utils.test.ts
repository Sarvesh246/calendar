import { describe, expect, it } from "vitest";
import {
  formatDaySummary,
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
