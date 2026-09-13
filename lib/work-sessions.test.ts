import { describe, expect, it } from "vitest";
import { findFreeSlot, formatDuration, plannedMinutes, workSessionsFor } from "./work-sessions";
import type { Item } from "./types";

const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m);

function event(id: string, start: Date, end?: Date, p: Partial<Item> = {}): Item {
  return {
    id,
    categoryId: "c",
    type: "event",
    title: id,
    at: start.toISOString(),
    ...(end ? { endAt: end.toISOString() } : {}),
    createdAt: start.toISOString(),
    ...p,
  };
}

describe("sessions", () => {
  it("finds and totals sessions for an item", () => {
    const items = [
      event("s2", at(17, 14), at(17, 15, 30), { workFor: "essay" }),
      event("s1", at(16, 9), at(16, 10), { workFor: "essay" }),
      event("other", at(16, 9), at(16, 10), { workFor: "lab" }),
    ];
    const sessions = workSessionsFor(items, "essay");
    expect(sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(plannedMinutes(sessions)).toBe(150);
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("findFreeSlot", () => {
  it("starts at the next quarter hour inside waking hours", () => {
    expect(findFreeSlot([], { from: at(16, 9, 7), minutes: 60 })).toEqual(at(16, 9, 15));
    expect(findFreeSlot([], { from: at(16, 6), minutes: 60 })).toEqual(at(16, 8));
  });

  it("skips past busy events and all-day items don't block", () => {
    const items = [
      event("class", at(16, 9), at(16, 10, 20)),
      event("holiday", at(16, 12), undefined, { allDay: true }),
    ];
    expect(findFreeSlot(items, { from: at(16, 9), minutes: 60 })).toEqual(at(16, 10, 30));
  });

  it("rolls to the next day when today is full", () => {
    expect(findFreeSlot([], { from: at(16, 21, 30), minutes: 60 })).toEqual(at(17, 8));
  });

  it("won't plan work after the deadline", () => {
    expect(findFreeSlot([], { from: at(16, 21, 30), minutes: 60, before: at(17, 8, 30) })).toBeNull();
  });
});
