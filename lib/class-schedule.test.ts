import { describe, expect, it } from "vitest";
import {
  extractScheduleDays,
  extractScheduleMeetings,
  firstSharedDay,
  parseClassSchedule,
} from "./class-schedule";

const cats = [{ id: "en", name: "ENGL 101", color: "#007AFF" }];

describe("extractScheduleDays", () => {
  it("reads MWF and TTh", () => {
    expect(extractScheduleDays("ENGL 101 MWF 10-10:50")?.days).toEqual([1, 3, 5]);
    expect(extractScheduleDays("lab TTh 2-3:15pm")?.days).toEqual([2, 4]);
  });

  it("reads spelled-out days", () => {
    expect(extractScheduleDays("Monday, Wednesday, Friday 9am")?.days).toEqual([1, 3, 5]);
  });

  it("can keep a single day when asked", () => {
    expect(extractScheduleDays("Friday lab", { minDays: 1 })?.days).toEqual([5]);
    expect(extractScheduleDays("Friday lab")).toBeNull();
  });
});

describe("extractScheduleMeetings", () => {
  it("splits compact day groups with their own times", () => {
    const r = extractScheduleMeetings("MATH MW 4:15-5:00 TTh 5:30-6:45");
    expect(r?.meetings).toEqual([
      { days: [1, 3], hour: 16, minute: 15, endHour: 17, endMinute: 0 },
      { days: [2, 4], hour: 17, minute: 30, endHour: 18, endMinute: 45 },
    ]);
    expect(r?.rest).toMatch(/MATH/i);
  });

  it("reads spelled-out split times", () => {
    const r = extractScheduleMeetings(
      "Tuesdays and Thursdays 5:30-6:45, Mondays and Wednesdays 4:15-5:00"
    );
    expect(r?.meetings).toEqual([
      { days: [2, 4], hour: 17, minute: 30, endHour: 18, endMinute: 45 },
      { days: [1, 3], hour: 16, minute: 15, endHour: 17, endMinute: 0 },
    ]);
  });

  it("keeps days that follow the time", () => {
    const r = extractScheduleMeetings("4:15-5:00 MW, 5:30-6:45 TTh");
    expect(r?.meetings.map((m) => m.days)).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });
});

describe("firstSharedDay", () => {
  it("returns the first weekday used twice", () => {
    expect(firstSharedDay([{ days: [1, 3] }, { days: [2, 3] }])).toBe(3);
    expect(firstSharedDay([{ days: [1, 3] }, { days: [2, 4] }])).toBeNull();
  });
});

describe("parseClassSchedule", () => {
  it("parses a typical syllabus line", () => {
    const r = parseClassSchedule("ENGL 101 MWF 10:00-10:50 Room 204 until Dec 12", cats);
    expect(r).not.toBeNull();
    expect(r?.categoryId).toBe("en");
    expect(r?.days).toEqual([1, 3, 5]);
    expect(r?.hour).toBe(10);
    expect(r?.minute).toBe(0);
    expect(r?.endHour).toBe(10);
    expect(r?.endMinute).toBe(50);
    expect(r?.location).toMatch(/204/);
    expect(r?.meetings).toHaveLength(1);
    expect(r?.meetings[0].hour).toBe(10);
  });

  it("parses two weekly times for one class", () => {
    const r = parseClassSchedule("MATH MW 4:15-5:00 TTh 5:30-6:45", cats);
    expect(r?.meetings).toHaveLength(2);
    expect(r?.meetings[0]).toMatchObject({ days: [1, 3], hour: 16, endHour: 17 });
    expect(r?.meetings[1]).toMatchObject({ days: [2, 4], hour: 17, minute: 30 });
  });

  it("returns null without days or a range", () => {
    expect(parseClassSchedule("just a title", cats)).toBeNull();
  });
});
