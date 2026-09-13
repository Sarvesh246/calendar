import { describe, expect, it } from "vitest";
import {
  dateFromDayKey,
  dayAtMinute,
  dayDelta,
  movedTimes,
  resizedEnd,
  shiftedByDays,
  snapMinutes,
  sweptRange,
} from "./calendar-drag-math";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("snapping and day keys", () => {
  it("snaps to the quarter hour", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(-8)).toBe(-15);
  });

  it("reads day keys as local dates", () => {
    const d = dateFromDayKey("2026-09-15");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 15, 0]);
    expect(dayAtMinute("2026-09-15", 14 * 60 + 30).toISOString()).toBe(local(2026, 9, 15, 14, 30));
    expect(dayDelta("2026-09-15", "2026-09-18")).toBe(3);
  });
});

describe("movedTimes", () => {
  it("lands a single-day event on the target slot and keeps its length", () => {
    const item = { at: local(2026, 9, 15, 9), endAt: local(2026, 9, 15, 10, 30) };
    expect(movedTimes(item, "2026-09-15", 540, "2026-09-17", 14 * 60)).toEqual({
      at: local(2026, 9, 17, 14),
      endAt: local(2026, 9, 17, 15, 30),
    });
  });

  it("moves an item with no end", () => {
    expect(movedTimes({ at: local(2026, 9, 15, 9) }, "2026-09-15", 540, "2026-09-14", 600)).toEqual({
      at: local(2026, 9, 14, 10),
    });
  });

  it("shifts a multi-day event dragged by a later segment as a whole", () => {
    const item = { at: local(2026, 9, 14, 22), endAt: local(2026, 9, 15, 2) };
    // The segment on the 15th starts at midnight; drop it on the 16th at 1:00.
    expect(movedTimes(item, "2026-09-15", 0, "2026-09-16", 60)).toEqual({
      at: local(2026, 9, 15, 23),
      endAt: local(2026, 9, 16, 3),
    });
  });
});

describe("shiftedByDays / resizedEnd", () => {
  it("keeps the wall-clock time", () => {
    expect(shiftedByDays({ at: local(2026, 9, 15, 23, 59) }, 2)).toEqual({ at: local(2026, 9, 17, 23, 59) });
  });

  it("never resizes below the minimum length", () => {
    const item = { at: local(2026, 9, 15, 9) };
    expect(resizedEnd(item, "2026-09-15", 11 * 60)).toBe(local(2026, 9, 15, 11));
    expect(resizedEnd(item, "2026-09-15", 8 * 60)).toBe(local(2026, 9, 15, 9, 15));
  });
});

describe("sweptRange", () => {
  it("covers the swept span either direction", () => {
    expect(sweptRange(9 * 60 + 10, 11 * 60 + 2, 420, 1320)).toEqual({ startMin: 540, endMin: 660 });
    // Sweeping upward still includes the quarter-hour the press started in.
    expect(sweptRange(11 * 60, 9 * 60 + 20, 420, 1320)).toEqual({ startMin: 555, endMin: 675 });
  });

  it("is at least one step long and stays in bounds", () => {
    expect(sweptRange(600, 601, 420, 1320)).toEqual({ startMin: 600, endMin: 615 });
    expect(sweptRange(1310, 1400, 420, 1320)).toEqual({ startMin: 1305, endMin: 1320 });
    expect(sweptRange(430, 100, 420, 1320)).toEqual({ startMin: 420, endMin: 435 });
  });
});
