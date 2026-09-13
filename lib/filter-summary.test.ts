import { describe, expect, it } from "vitest";
import { summariseFilters } from "./filter-summary";
import type { Category } from "./types";

const cats: Category[] = [
  { id: "a", name: "COMU 010", color: "#f00" },
  { id: "b", name: "EXEX 101", color: "#0f0" },
  { id: "c", name: "BIOL 111", color: "#00f" },
];

describe("summariseFilters", () => {
  it("reports nothing when no filter is on", () => {
    const s = summariseFilters(cats, null, false);
    expect(s.active).toBe(false);
    expect(s.parts).toEqual([]);
    expect(s.label).toBe("");
  });

  it("names a single class rather than counting it", () => {
    expect(summariseFilters(cats, ["a"], false).label).toBe("COMU 010");
  });

  it("counts multiple classes and joins with the completion filter", () => {
    const s = summariseFilters(cats, ["a", "b"], true);
    expect(s.label).toBe("2 classes · Incomplete");
    expect(s.parts).toEqual(["2 classes", "Incomplete"]);
    expect(s.active).toBe(true);
  });

  it("reports hide-completed on its own", () => {
    expect(summariseFilters(cats, null, true).label).toBe("Incomplete");
  });

  it("ignores ids whose class no longer exists", () => {
    // A class deleted on another device leaves its id in the filter. Counting
    // it would claim a filter with no row in the sheet to switch off.
    const s = summariseFilters(cats, ["a", "gone"], false);
    expect(s.label).toBe("COMU 010");
  });

  it("treats a filter of only dead ids as no filter", () => {
    expect(summariseFilters(cats, ["gone", "also-gone"], false).active).toBe(false);
  });

  it("spells the classes out for screen readers", () => {
    const s = summariseFilters(cats, ["a", "b"], true);
    expect(s.announcement).toBe(
      "Filtered by 2 classes: COMU 010, EXEX 101, and completed items hidden"
    );
  });
});

describe("summariseFilters with a saved view", () => {
  it("leads with the view, since it set the rest", () => {
    const s = summariseFilters(cats, ["a", "b"], true, "Deep work");
    expect(s.label).toBe("Deep work · 2 classes · Incomplete");
    expect(s.announcement).toBe(
      "Filtered by the Deep work view, and 2 classes: COMU 010, EXEX 101, and completed items hidden"
    );
  });

  it("counts a view on its own as an active filter", () => {
    const s = summariseFilters(cats, null, false, "This week");
    expect(s.active).toBe(true);
    expect(s.label).toBe("This week");
  });

  it("ignores an absent or blank view name", () => {
    expect(summariseFilters(cats, null, false, null).active).toBe(false);
    expect(summariseFilters(cats, null, false, "   ").active).toBe(false);
  });
});
