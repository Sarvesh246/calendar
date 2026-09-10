import { describe, expect, it } from "vitest";
import { extractScheduleDays, parseClassSchedule } from "./class-schedule";

const cats = [{ id: "en", name: "ENGL 101", color: "#007AFF" }];

describe("extractScheduleDays", () => {
  it("reads MWF and TTh", () => {
    expect(extractScheduleDays("ENGL 101 MWF 10-10:50")?.days).toEqual([1, 3, 5]);
    expect(extractScheduleDays("lab TTh 2-3:15pm")?.days).toEqual([2, 4]);
  });

  it("reads spelled-out days", () => {
    expect(extractScheduleDays("Monday, Wednesday, Friday 9am")?.days).toEqual([1, 3, 5]);
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
  });

  it("returns null without days or a range", () => {
    expect(parseClassSchedule("just a title", cats)).toBeNull();
  });
});
