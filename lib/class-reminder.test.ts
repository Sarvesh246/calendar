import { describe, expect, it } from "vitest";
import {
  CLASS_REMINDER_OPTIONS,
  classCountdownWindowMs,
  classReminderFor,
  classReminderLabel,
  classReminderOptionLabel,
  normalizeClassReminderMinutes,
} from "./class-reminder";
import type { Item } from "./types";

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

describe("normalizeClassReminderMinutes", () => {
  it("falls back to the default for anything unusable", () => {
    expect(normalizeClassReminderMinutes(undefined)).toBe(10);
    expect(normalizeClassReminderMinutes(null)).toBe(10);
    expect(normalizeClassReminderMinutes(NaN)).toBe(10);
    expect(normalizeClassReminderMinutes("30")).toBe(10);
  });

  it("keeps a real choice, floors negatives to off, and caps at a day", () => {
    expect(normalizeClassReminderMinutes(30)).toBe(30);
    expect(normalizeClassReminderMinutes(0)).toBe(0);
    expect(normalizeClassReminderMinutes(-5)).toBe(0);
    expect(normalizeClassReminderMinutes(12.4)).toBe(12);
    expect(normalizeClassReminderMinutes(99_999)).toBe(1440);
  });
});

describe("labels", () => {
  it("writes chip copy and notification copy", () => {
    expect(classReminderOptionLabel(0)).toBe("Off");
    expect(classReminderOptionLabel(30)).toBe("30 min");
    expect(classReminderOptionLabel(60)).toBe("1 hr");
    expect(classReminderLabel(1)).toBe("1 minute before");
    expect(classReminderLabel(30)).toBe("30 minutes before");
    expect(classReminderLabel(120)).toBe("2 hours before");
  });

  it("offers Off plus a spread of offsets", () => {
    expect(CLASS_REMINDER_OPTIONS[0]).toBe(0);
    expect(CLASS_REMINDER_OPTIONS).toContain(10);
    expect(CLASS_REMINDER_OPTIONS).toContain(30);
  });
});

describe("classCountdownWindowMs", () => {
  it("is the same number the notification uses", () => {
    expect(classCountdownWindowMs(30)).toBe(30 * 60_000);
    expect(classCountdownWindowMs(0)).toBe(0);
    expect(classCountdownWindowMs(undefined as unknown as number)).toBe(10 * 60_000);
  });
});

describe("classReminderFor", () => {
  it("synthesizes a heads-up at the chosen offset", () => {
    const reminder = classReminderFor(lecture(), 30);
    expect(reminder).toEqual({
      id: "class-30",
      itemId: "class-1",
      offsetMinutes: 30,
      label: "30 minutes before",
    });
  });

  it("gives no heads-up when alerts are off", () => {
    expect(classReminderFor(lecture(), 0)).toBeNull();
  });

  it("skips anything that isn't a weekly class meeting", () => {
    expect(classReminderFor(lecture({ repeat: undefined }), 10)).toBeNull();
    expect(classReminderFor(lecture({ sourceId: "canvas" }), 10)).toBeNull();
    expect(classReminderFor(lecture({ allDay: true }), 10)).toBeNull();
    expect(classReminderFor(lecture({ type: "assignment" }), 10)).toBeNull();
    expect(classReminderFor(lecture({ status: "done" }), 10)).toBeNull();
  });

  it("defers to a reminder the user attached at the same offset", () => {
    const own = { id: "r1", itemId: "class-1", offsetMinutes: 30, label: "Leave now" };
    expect(classReminderFor(lecture({ reminders: [own] }), 30)).toBeNull();
    expect(classReminderFor(lecture({ reminders: [own] }), 15)?.id).toBe("class-15");
  });
});
