import { describe, expect, it } from "vitest";
import { summarizeItemWhen } from "./item-summary";
import type { Item } from "./types";

const now = new Date(2026, 9, 9, 10, 0);

function work(over: Partial<Item>): Item {
  return {
    id: "a",
    categoryId: "c",
    type: "assignment",
    title: "Essay",
    at: new Date(2026, 9, 9, 23, 59).toISOString(),
    createdAt: now.toISOString(),
    ...over,
  };
}

describe("summarizeItemWhen", () => {
  it("calls work due later today 'Due today'", () => {
    const s = summarizeItemWhen(work({}), now, false);
    expect(s.chip).toEqual({ label: "Due today", tone: "accent" });
    expect(s.date).toBe("Friday, October 9");
  });

  it("names how late overdue work is", () => {
    const s = summarizeItemWhen(work({ at: new Date(2026, 9, 7, 12).toISOString() }), now, false);
    expect(s.chip).toEqual({ label: "2 days overdue", tone: "warn" });
  });

  it("reports completed work as done, not overdue", () => {
    const s = summarizeItemWhen(
      work({
        at: new Date(2026, 9, 7, 12).toISOString(),
        status: "done",
        completedAt: new Date(2026, 9, 8, 9).toISOString(),
      }),
      now,
      false
    );
    expect(s.chip).toEqual({ label: "Done yesterday", tone: "good" });
  });

  it("shows an event's time range", () => {
    const s = summarizeItemWhen(
      work({
        type: "event",
        at: new Date(2026, 9, 10, 9).toISOString(),
        endAt: new Date(2026, 9, 10, 10, 15).toISOString(),
      }),
      now,
      false
    );
    expect(s.time).toBe("9:00 AM – 10:15 AM");
    expect(s.chip.label).toBe("Tomorrow");
  });
});
