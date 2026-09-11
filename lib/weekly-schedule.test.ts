import { describe, expect, it } from "vitest";
import { buildWeeklySchedule, placeDayBlocks, formatDuration } from "./weekly-schedule";
import type { Item } from "./types";

const NOW = new Date("2026-09-16T12:00:00");

function event(partial: Partial<Item> & { at: string }): Item {
  return {
    id: partial.at + (partial.title ?? ""),
    categoryId: "c1",
    type: "event",
    title: "ENGR 102",
    createdAt: NOW.toISOString(),
    ...partial,
  };
}

/** A class at the same weekday + time across `weeks` consecutive weeks. */
function weekly(title: string, firstAt: string, endAt: string, weeks: number): Item[] {
  return Array.from({ length: weeks }, (_, i) => {
    const start = new Date(firstAt);
    start.setDate(start.getDate() + i * 7);
    const end = new Date(endAt);
    end.setDate(end.getDate() + i * 7);
    return event({ id: `${title}-${i}`, title, at: start.toISOString(), endAt: end.toISOString() });
  });
}

describe("buildWeeklySchedule", () => {
  it("keeps an event seen on the same weekday and time in two different weeks", () => {
    const items = weekly("ENGR 102", "2026-09-14T09:00:00", "2026-09-14T09:50:00", 3);
    const schedule = buildWeeklySchedule(items, NOW);
    expect(schedule.blocks).toHaveLength(1);
    expect(schedule.blocks[0]).toMatchObject({ day: 1, startMin: 540, endMin: 590, weeks: 3 });
    expect(schedule.meetingsPerWeek).toBe(1);
    expect(schedule.minutesPerWeek).toBe(50);
    expect(schedule.days).toEqual([1]);
  });

  it("drops a one-off that never repeats", () => {
    const items = [
      event({ title: "Career Fair", at: "2026-09-17T09:00:00", endAt: "2026-09-17T17:00:00" }),
    ];
    expect(buildWeeklySchedule(items, NOW).blocks).toHaveLength(0);
  });

  it("keeps a declared weekly series even when only one occurrence is in range", () => {
    const items = [
      event({
        title: "GEOG 205 Lab",
        at: "2026-09-18T14:20:00",
        endAt: "2026-09-18T15:35:00",
        repeat: { freq: "weekly", byDay: [5] },
      }),
    ];
    const schedule = buildWeeklySchedule(items, NOW);
    expect(schedule.blocks).toHaveLength(1);
    expect(schedule.blocks[0].recurring).toBe(true);
  });

  it("treats two different times on one day as two blocks", () => {
    const items = [
      ...weekly("MATH 151", "2026-09-15T08:00:00", "2026-09-15T09:15:00", 2),
      ...weekly("MATH 151 Recitation", "2026-09-15T13:00:00", "2026-09-15T14:15:00", 2),
    ];
    const schedule = buildWeeklySchedule(items, NOW);
    expect(schedule.blocks).toHaveLength(2);
    expect(schedule.days).toEqual([2]);
    expect(schedule.earliestMin).toBe(480);
    expect(schedule.latestMin).toBe(855);
  });

  it("ignores all-day events and assignments", () => {
    const items = [
      ...weekly("Reading", "2026-09-15T00:00:00", "2026-09-15T23:59:00", 3).map((i) => ({
        ...i,
        allDay: true,
      })),
      ...weekly("Weekly quiz", "2026-09-16T23:59:00", "2026-09-17T00:00:00", 3).map((i) => ({
        ...i,
        type: "assignment" as const,
      })),
    ];
    expect(buildWeeklySchedule(items, NOW).blocks).toHaveLength(0);
  });

  it("orders days from the configured first day of the week", () => {
    const items = [
      ...weekly("Sunday lab", "2026-09-13T10:00:00", "2026-09-13T11:00:00", 2),
      ...weekly("Monday lecture", "2026-09-14T10:00:00", "2026-09-14T11:00:00", 2),
    ];
    expect(buildWeeklySchedule(items, NOW, 0).days).toEqual([0, 1]);
    expect(buildWeeklySchedule(items, NOW, 1).days).toEqual([1, 0]);
  });

  it("gives a timed event with no end a default block length", () => {
    const items = weekly("Office hours", "2026-09-16T16:00:00", "2026-09-16T16:00:00", 2).map(
      (i) => ({ ...i, endAt: undefined })
    );
    expect(buildWeeklySchedule(items, NOW).blocks[0]).toMatchObject({
      startMin: 960,
      endMin: 1010,
    });
  });
});

describe("placeDayBlocks", () => {
  const block = (startMin: number, endMin: number, key: string) => ({
    key,
    title: key,
    day: 1,
    startMin,
    endMin,
    weeks: 2,
    recurring: false,
  });

  it("gives a lone class the whole column", () => {
    const [only] = placeDayBlocks([block(540, 590, "a")]);
    expect(only).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("splits overlapping classes into side-by-side lanes", () => {
    const placed = placeDayBlocks([block(540, 640, "a"), block(560, 620, "b")]);
    expect(placed.map((b) => b.lane)).toEqual([0, 1]);
    expect(placed.every((b) => b.lanes === 2)).toBe(true);
  });

  it("does not let one busy cluster narrow a later free one", () => {
    const placed = placeDayBlocks([
      block(540, 640, "a"),
      block(560, 620, "b"),
      block(700, 760, "c"),
    ]);
    expect(placed.find((b) => b.key === "c")).toMatchObject({ lane: 0, lanes: 1 });
  });
});

describe("formatDuration", () => {
  it("reads as a person would say it", () => {
    expect(formatDuration(50)).toBe("50m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(145)).toBe("2h 25m");
  });
});
