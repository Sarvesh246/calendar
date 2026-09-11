import { describe, expect, it } from "vitest";
import { weekEventWindow } from "./week-layout";
import type { Item } from "./types";

function event(at: string, endAt?: string): Item {
  return { id: "e", categoryId: "personal", title: "Event", type: "event", at, endAt, createdAt: at };
}

describe("week event windows", () => {
  it("splits an overnight event at midnight", () => {
    const item = event("2026-09-11T22:00:00", "2026-09-12T06:00:00");
    expect(weekEventWindow(item, new Date("2026-09-11T12:00:00"))).toEqual({ startMin: 1320, endMin: 1440 });
    expect(weekEventWindow(item, new Date("2026-09-12T12:00:00"))).toEqual({ startMin: 0, endMin: 360 });
  });
  it("uses each day's session for a multi-day daytime event", () => {
    const item = event("2026-09-11T09:00:00", "2026-09-13T17:00:00");
    expect(weekEventWindow(item, new Date("2026-09-12T12:00:00"))).toEqual({ startMin: 540, endMin: 1020 });
  });
  it("caps an event without an end at the day boundary", () => {
    expect(weekEventWindow(event("2026-09-11T23:45:00"), new Date("2026-09-11T12:00:00")))
      .toEqual({ startMin: 1425, endMin: 1440 });
  });
});
