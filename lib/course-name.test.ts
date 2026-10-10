import { describe, expect, it } from "vitest";
import { courseLabels, courseOnlyLabel, itemDisplayTitle, parseCourseName } from "./course-name";
import type { Category, Item } from "./types";

describe("parseCourseName", () => {
  it("cleans registrar-style codes and keeps sections as detail", () => {
    expect(parseCourseName("ENGR-102:204,218,505,568")).toMatchObject({
      label: "ENGR 102",
      detail: "Sections 204, 218, 505, 568",
    });
    expect(parseCourseName("POLS 207 508:")).toMatchObject({ label: "POLS 207", detail: "Section 508" });
    expect(parseCourseName("MATH-150:533,534,535").label).toBe("MATH 150");
    expect(parseCourseName("COMU-010-CORT")).toMatchObject({ label: "COMU 010", detail: "CORT" });
  });

  it("keeps a course title as detail", () => {
    expect(parseCourseName("CS 101 - Intro to Programming")).toMatchObject({
      label: "CS 101",
      detail: "Intro to Programming",
    });
  });

  it("leaves ordinary names alone", () => {
    expect(parseCourseName("Personal").label).toBe("Personal");
    expect(parseCourseName("Work").label).toBe("Work");
    expect(parseCourseName("Week 7 study group").label).toBe("Week 7 study group");
    expect(parseCourseName("Lab 12").label).toBe("Lab 12");
  });
});

describe("courseLabels", () => {
  it("tells colliding codes apart by first section", () => {
    const cats = [
      { id: "a", name: "ENGR-102:204,218,505,568", color: "#f00" },
      { id: "b", name: "ENGR-102:201,204,208,210", color: "#0f0" },
      { id: "c", name: "MATH-150:533", color: "#00f" },
    ] as Category[];
    const labels = courseLabels(cats);
    expect(labels.get("a")?.label).toBe("ENGR 102 · 204");
    expect(labels.get("b")?.label).toBe("ENGR 102 · 201");
    expect(labels.get("c")?.label).toBe("MATH 150");
  });
});

describe("item titles", () => {
  const base = { id: "1", categoryId: "c", type: "event", at: "2026-10-12T10:20:00", createdAt: "" } as Item;

  it("reduces a code-only title to the code", () => {
    expect(courseOnlyLabel("POLS 207 508:")).toBe("POLS 207");
    expect(itemDisplayTitle({ ...base, title: "MATH-150:533,534,535" })).toBe("MATH 150");
  });

  it("never touches a title with words", () => {
    expect(courseOnlyLabel("Math 150 Algebra Review Week 7")).toBeNull();
    expect(itemDisplayTitle({ ...base, title: "Packback #6 - Question Due October 8th" })).toBe(
      "Packback #6 - Question Due October 8th"
    );
    expect(courseOnlyLabel("CS 101 Final exam")).toBeNull();
  });
});
