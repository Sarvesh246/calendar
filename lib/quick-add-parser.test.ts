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
});
