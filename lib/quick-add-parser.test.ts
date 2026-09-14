import { addDays, startOfDay } from "date-fns";
import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add-parser";

const cats = [{ id: "cs", name: "Computer Science", color: "#000" }];

describe("parseQuickAdd", () => {
  it("parses a weekday and due assignment", () => {
    const r = parseQuickAdd("essay due friday", cats);
    expect(r.type).toBe("assignment");
    expect(r.title.toLowerCase()).toContain("essay");
    expect(r.confidence.date).toBe(true);
  });

  it("matches a category acronym", () => {
    const r = parseQuickAdd("CS quiz friday", cats);
    expect(r.categoryId).toBe("cs");
    expect(r.confidence.category).toBe(true);
  });

  it("parses a 2–3pm range", () => {
    const r = parseQuickAdd("lab 2-3pm tomorrow", cats);
    expect(r.at.getHours()).toBe(14);
    expect(r.endAt?.getHours()).toBe(15);
  });

  it("parses yesterday as the previous local day", () => {
    const r = parseQuickAdd("lab report yesterday 11:59pm", cats);
    expect(r.confidence.date).toBe(true);
    const y = addDays(startOfDay(new Date()), -1);
    expect(r.at.getFullYear()).toBe(y.getFullYear());
    expect(r.at.getMonth()).toBe(y.getMonth());
    expect(r.at.getDate()).toBe(y.getDate());
    expect(r.type).toBe("assignment");
  });

  it("parses all day", () => {
    const r = parseQuickAdd("retreat all day saturday", cats);
    expect(r.allDay).toBe(true);
  });

  it("parses next Friday as the following Friday, not today", () => {
    const r = parseQuickAdd("dentist next friday 2pm", cats);
    expect(r.confidence.date).toBe(true);
    expect(r.at.getDay()).toBe(5);
  });

  it("parses every tuesday as weekly", () => {
    const r = parseQuickAdd("standup every tuesday 10am", cats);
    expect(r.repeat?.freq).toBe("weekly");
    expect(r.repeat?.byDay).toEqual([2]);
  });

  it("parses MWF as a weekly class", () => {
    const r = parseQuickAdd("lecture MWF 10-10:50am", cats);
    expect(r.repeat?.freq).toBe("weekly");
    expect(r.repeat?.byDay).toEqual([1, 3, 5]);
    expect(r.at.getHours()).toBe(10);
    expect(r.endAt?.getHours()).toBe(10);
    expect(r.endAt?.getMinutes()).toBe(50);
  });

  it("reads a spoken meeting with two reminders, a time, and a place", () => {
    const sentence =
      "add an event with a reminder for a day before and a reminder for a couple hours before to do my Hullabaloo U meeting at 5:30 at the PLNK Building First floor by the starbucks?";
    const r = parseQuickAdd(sentence, cats);
    expect(r.type).toBe("event");
    expect(r.title).toBe("Hullabaloo U meeting");
    expect(r.at.getHours()).toBe(17);
    expect(r.at.getMinutes()).toBe(30);
    expect(r.location).toMatch(/PLNK Building/i);
    expect(r.location).toMatch(/starbucks/i);
    expect(r.reminders?.map((x) => x.offsetMinutes).sort((a, b) => a - b)).toEqual([120, 1440]);
  });

  it("treats 1–6 without am/pm as afternoon", () => {
    expect(parseQuickAdd("coffee at 5:30", cats).at.getHours()).toBe(17);
    expect(parseQuickAdd("standup at 9:00", cats).at.getHours()).toBe(9);
  });

  it("still honors an explicit morning", () => {
    expect(parseQuickAdd("coffee at 5:30am", cats).at.getHours()).toBe(5);
  });
});
