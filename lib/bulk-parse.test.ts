import { describe, expect, it } from "vitest";
import { looksLikeBulkPaste, parseBulk } from "./bulk-parse";
import type { Category } from "./types";

const NOW = new Date(2026, 8, 2);
const categories: Category[] = [
  { id: "engr", name: "ENGR-102:201,204", color: "#111" },
  { id: "math", name: "MATH-150:533", color: "#222" },
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// The exact block from the bug report.
const CAREER_FAIR = [
  "Sept. 9-10 \tEngineering Career Fair* \tLegends Event Center in Bryan, TX \tcareerfair@sec.tamu.edu",
  "Sept. 11 \tEngineering Career Fair* \tVirtual on Symplicity \tcareerfair@sec.tamu.edu",
].join("\n");

describe("looksLikeBulkPaste", () => {
  it("recognises two or more dated lines", () => {
    expect(looksLikeBulkPaste(CAREER_FAIR)).toBe(true);
  });

  it("leaves a single item alone", () => {
    expect(looksLikeBulkPaste("Sept. 11 Career Fair")).toBe(false);
  });

  it("leaves undated prose alone", () => {
    expect(looksLikeBulkPaste("finish lab report\nemail the TA")).toBe(false);
  });
});

describe("parseBulk", () => {
  it("splits a pasted schedule into one item per row", () => {
    const { drafts, skipped } = parseBulk(CAREER_FAIR, categories, NOW);
    expect(skipped).toEqual([]);
    expect(drafts).toHaveLength(2);

    expect(drafts[0].title).toBe("Engineering Career Fair");
    expect(ymd(drafts[0].at)).toBe("2026-09-09");
    expect(ymd(drafts[0].endAt!)).toBe("2026-09-10");
    expect(drafts[0].allDay).toBe(true);
    expect(drafts[0].location).toBe("Legends Event Center in Bryan, TX");
    expect(drafts[0].description).toContain("careerfair@sec.tamu.edu");

    expect(ymd(drafts[1].at)).toBe("2026-09-11");
    expect(drafts[1].endAt).toBeUndefined();
    expect(drafts[1].location).toBe("Virtual on Symplicity");
  });

  it("keeps a title that shares a cell with the date", () => {
    const { drafts } = parseBulk("Oct 3 Homecoming\nOct 10 Parents weekend", categories, NOW);
    expect(drafts.map((d) => d.title)).toEqual(["Homecoming", "Parents weekend"]);
    expect(ymd(drafts[0].at)).toBe("2026-10-03");
  });

  it("classifies deadline wording as an assignment", () => {
    const { drafts } = parseBulk(
      "Oct 3\tEssay 1 due\nOct 10\tGuest lecture",
      categories,
      NOW
    );
    expect(drafts[0].type).toBe("assignment");
    expect(drafts[1].type).toBe("event");
  });

  it("matches a course code to an existing category", () => {
    const { drafts } = parseBulk("Oct 3\tENGR 102 project milestone", categories, NOW);
    expect(drafts[0].categoryId).toBe("engr");
  });

  it("reports lines it could not date instead of guessing", () => {
    const { drafts, skipped } = parseBulk(
      "Sept. 9\tOrientation\nsomething with no date\nSept. 12\tAdvising",
      categories,
      NOW
    );
    expect(drafts).toHaveLength(2);
    expect(skipped).toEqual(["something with no date"]);
  });

  it("handles pipe-separated and multi-space tables", () => {
    const piped = parseBulk("Sept. 9 | Orientation | Rudder\nSept. 12 | Advising | Zach", categories, NOW);
    expect(piped.drafts).toHaveLength(2);
    expect(piped.drafts[0].location).toBe("Rudder");

    const spaced = parseBulk("Sept. 9    Orientation\nSept. 12    Advising", categories, NOW);
    expect(spaced.drafts.map((d) => d.title)).toEqual(["Orientation", "Advising"]);
  });
});
