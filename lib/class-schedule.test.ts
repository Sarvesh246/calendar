import { describe, expect, it } from "vitest";
import {
  extractScheduleDays,
  extractScheduleMeetings,
  firstSharedDay,
  formatMeetingSummary,
  meetingDateTimes,
  parseClassSchedule,
  parseClockInput,
  savedClassMeetings,
  soonestOnDays,
  isClassScheduleItem,
} from "./class-schedule";
import type { Item } from "./types";

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

describe("parseClockInput", () => {
  it("reads HH:MM and HH:MM:SS", () => {
    expect(parseClockInput("10:20")).toEqual({ hour: 10, minute: 20 });
    expect(parseClockInput("11:10:00")).toEqual({ hour: 11, minute: 10 });
    expect(parseClockInput("")).toBeNull();
    expect(parseClockInput("10:20 AM")).toBeNull();
  });
});

describe("soonestOnDays", () => {
  it("keeps today when it is selected", () => {
    const thu = new Date(2026, 8, 10, 21, 7); // Thursday
    expect(soonestOnDays([2, 4], thu).getDay()).toBe(4);
    expect(soonestOnDays([2, 4], thu).getDate()).toBe(10);
  });

  it("picks the next selected day later this week", () => {
    const thu = new Date(2026, 8, 10, 21, 7);
    const next = soonestOnDays([1, 3, 5], thu);
    expect(next.getDay()).toBe(5);
    expect(next.getDate()).toBe(11);
  });
});

describe("meetingDateTimes", () => {
  it("anchors a MWF series on this week's Friday when added Thursday", () => {
    const thu = new Date(2026, 8, 10, 21, 7);
    const range = meetingDateTimes(
      { days: [1, 3, 5], hour: 10, minute: 20, endHour: 11, endMinute: 10 },
      thu
    );
    expect(range).not.toBeNull();
    expect(range!.at.getDay()).toBe(5);
    expect(range!.at.getHours()).toBe(10);
    expect(range!.at.getMinutes()).toBe(20);
    expect(range!.endAt.getHours()).toBe(11);
  });
});

describe("savedClassMeetings", () => {
  const item = (over: Partial<Item>): Item => ({
    id: "1",
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

  it("groups a weekly series and labels the meeting", () => {
    const items = [
      item({ id: "a" }),
      item({ id: "b", at: new Date(2026, 8, 14, 10, 20).toISOString(), endAt: new Date(2026, 8, 14, 11, 10).toISOString() }),
    ];
    const saved = savedClassMeetings(items, "pols");
    expect(saved).toHaveLength(1);
    expect(saved[0].count).toBe(2);
    expect(saved[0].ids).toEqual(["a", "b"]);
    expect(saved[0].days).toEqual([1, 3, 5]);
    expect(formatMeetingSummary(saved[0])).toBe("Mon/Wed/Fri 10:20–11:10 AM");
  });

  it("keeps split weekly times as two rows", () => {
    const items = [
      item({ id: "mw", repeatId: "a", repeat: { freq: "weekly", byDay: [1, 3] }, at: new Date(2026, 8, 14, 16, 15).toISOString(), endAt: new Date(2026, 8, 14, 17, 0).toISOString() }),
      item({ id: "tth", repeatId: "b", repeat: { freq: "weekly", byDay: [2, 4] }, at: new Date(2026, 8, 15, 17, 30).toISOString(), endAt: new Date(2026, 8, 15, 18, 45).toISOString() }),
    ];
    const saved = savedClassMeetings(items, "pols");
    expect(saved.map((m) => formatMeetingSummary(m))).toEqual([
      "Mon/Wed 4:15–5:00 PM",
      "Tue/Thu 5:30–6:45 PM",
    ]);
  });

  it("ignores imported feed events", () => {
    expect(savedClassMeetings([item({ sourceId: "feed" })], "pols")).toEqual([]);
  });

  it("recognizes user-created weekly lectures", () => {
    expect(isClassScheduleItem(item({}))).toBe(true);
    expect(isClassScheduleItem(item({ sourceId: "feed" }))).toBe(false);
    expect(isClassScheduleItem(item({ type: "assignment", repeat: undefined }))).toBe(false);
  });
});
