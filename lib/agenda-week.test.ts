import { describe, expect, it } from "vitest";
import { describeWeekDay, scheduledLabel, summarizeWeek } from "./agenda-week";
import { formatTimeSpan, groupItemsByDay } from "./date-utils";
import type { Item } from "./types";

const item = (over: Partial<Item>): Item =>
  ({ id: Math.random().toString(36), categoryId: "c", type: "assignment", title: "x", createdAt: "", ...over }) as Item;

describe("summarizeWeek", () => {
  // Friday, Oct 9 2026, mid-afternoon.
  const now = new Date(2026, 9, 9, 15, 0);

  it("counts each kind of thing on its own day", () => {
    const items = [
      item({ at: new Date(2026, 9, 9, 23, 59).toISOString() }),
      item({ at: new Date(2026, 9, 9, 9, 0).toISOString() }),
      item({ at: new Date(2026, 9, 8, 12, 0).toISOString(), status: "done" }),
      item({ type: "event", at: new Date(2026, 9, 9, 10, 0).toISOString(), endAt: new Date(2026, 9, 9, 11, 0).toISOString(), repeat: { freq: "weekly" } as Item["repeat"] }),
      item({ type: "event", at: new Date(2026, 9, 10, 19, 0).toISOString(), endAt: new Date(2026, 9, 10, 22, 0).toISOString(), title: "Concert" }),
    ];
    const week = summarizeWeek(groupItemsByDay(items), now, 0, () => "Personal");
    const fri = week.find((d) => d.isToday)!;
    expect(week).toHaveLength(7);
    expect(fri).toMatchObject({ due: 1, overdue: 1 });
    expect(week[4]).toMatchObject({ done: 1, isPast: true });
    expect(week[6]).toMatchObject({ events: 1 });
  });

  it("describes empty days honestly", () => {
    const [sun] = summarizeWeek(new Map(), now, 0, () => undefined);
    expect(describeWeekDay(sun)).toBe("Nothing scheduled");
    expect(scheduledLabel(0, 0)).toBeNull();
    expect(scheduledLabel(2, 0)).toBe("2 classes");
    expect(scheduledLabel(2, 1)).toBe("3 events");
  });
});

describe("formatTimeSpan", () => {
  it("shares one meridiem when both ends have it", () => {
    const a = new Date(2026, 9, 12, 10, 20).toISOString();
    const b = new Date(2026, 9, 12, 11, 10).toISOString();
    const c = new Date(2026, 9, 12, 13, 0).toISOString();
    expect(formatTimeSpan(a, b, false)).toBe("10:20–11:10 AM");
    expect(formatTimeSpan(a, c, false)).toBe("10:20 AM–1:00 PM");
    expect(formatTimeSpan(a, undefined, false)).toBe("10:20 AM");
    expect(formatTimeSpan(a, b, true)).toBe("10:20–11:10");
  });
});
