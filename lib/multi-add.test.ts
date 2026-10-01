import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import { parseMultiAdd } from "./multi-add";
import { looksLikeBulkPaste, parseBulk } from "./bulk-parse";
import { localAnswer } from "./ai-assistant";

const NOW = new Date(2026, 8, 23, 10, 0);
// Relative words ("tomorrow", "fri") resolve against the real clock, so pin it.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const categories = [{ id: "c1", name: "Clubs", color: "#3DBE8B" }];

const INTERVIEWS = `add these to my calendar:
FLIP Interview: Fri Sep 25, 2026 4:45 pm
Location: Rudder 510

FRESH Interview: Fri Sep 25, 2026 2:00 pm
Location: Annex 2nd floor

FAST Interview: Fri Sep 25, 2026 3:00 pm
Location: MSC Second Floor couches (above help desk)

FOUR Interview: Fri Sep 25, 2026 12:40 pm
Location: Rudder 504

FORME Interview: Fri Sep 25, 2026 3:40 pm
Location: Rudder 402 Link`;

const stamp = (d: Date) => format(d, "yyyy-MM-dd HH:mm");

describe("parseMultiAdd", () => {
  it("splits interviews into one event each with time and location", () => {
    const { drafts, skipped } = parseMultiAdd(INTERVIEWS, categories, NOW);
    expect(skipped).toEqual([]);
    expect(drafts.map((d) => d.title)).toEqual([
      "FLIP Interview", "FRESH Interview", "FAST Interview", "FOUR Interview", "FORME Interview",
    ]);
    expect(drafts.map((d) => stamp(d.at))).toEqual([
      "2026-09-25 16:45", "2026-09-25 14:00", "2026-09-25 15:00", "2026-09-25 12:40", "2026-09-25 15:40",
    ]);
    expect(drafts.map((d) => d.location)).toEqual([
      "Rudder 510", "Annex 2nd floor", "MSC Second Floor couches (above help desk)", "Rudder 504", "Rudder 402 Link",
    ]);
    expect(drafts.every((d) => !d.allDay && d.type === "event")).toBe(true);
  });

  it("works without blank lines or the intro", () => {
    const { drafts } = parseMultiAdd(
      "Dentist: Sep 28 9:00 am\nLocation: Main St\nGym: Sep 28 6pm\nLocation: Rec Center",
      categories,
      NOW
    );
    expect(drafts.map((d) => [d.title, d.location])).toEqual([["Dentist", "Main St"], ["Gym", "Rec Center"]]);
  });

  it("uses a date header for time-only lines", () => {
    const { drafts } = parseMultiAdd("Friday, Sep 25:\n2:00 pm FRESH Interview\n3:00 pm FAST Interview", categories, NOW);
    expect(drafts.map((d) => stamp(d.at))).toEqual(["2026-09-25 14:00", "2026-09-25 15:00"]);
    expect(drafts.map((d) => d.title)).toEqual(["FRESH Interview", "FAST Interview"]);
  });

  it("reads inline locations and relative days", () => {
    const { drafts } = parseMultiAdd("- coffee with Sam tomorrow 3pm, Location: Cafe\n- gym fri 6pm", categories, NOW);
    expect(drafts).toHaveLength(2);
    expect(stamp(drafts[0].at)).toBe("2026-09-24 15:00");
    expect(drafts[0].location).toBe("Cafe");
    expect(stamp(drafts[1].at)).toBe("2026-09-25 18:00");
  });

  it("keeps one event with detail lines as one event", () => {
    const { drafts } = parseMultiAdd("Team dinner Sep 26 7pm\nLocation: Torchy's\nBring the gift", categories, NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].description).toBe("Bring the gift");
  });

  it("does not treat a single sentence as a list", () => {
    expect(parseMultiAdd("add gym tomorrow at 6pm", categories, NOW).drafts.length).toBeLessThan(2);
  });
});

describe("integration", () => {
  it("quick-add treats the paste as a multi-add", () => {
    expect(looksLikeBulkPaste(INTERVIEWS)).toBe(true);
    expect(parseBulk(INTERVIEWS, categories, NOW).drafts).toHaveLength(5);
  });

  it("the offline assistant proposes one create action per event, in time order", () => {
    const res = localAnswer(INTERVIEWS, { items: [], categories } as never, NOW);
    expect(res.actions).toHaveLength(5);
    expect(res.actions!.map((a) => (a.kind === "create" ? a.draft.title : ""))[0]).toBe("FOUR Interview");
  });
});
