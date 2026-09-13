import { describe, expect, it } from "vitest";
import { agendaStickyFace, type AgendaStickySection } from "./agenda-sticky";

const now = new Date("2026-09-13T12:00:00");

describe("agendaStickyFace", () => {
  it("treats overdue as a count, not a calendar day", () => {
    const section: AgendaStickySection = { id: "overdue", kind: "overdue", tone: "warn", count: 4 };
    expect(agendaStickyFace(section, now)).toEqual({
      numeral: "4",
      kicker: "Overdue",
      subtitle: "items",
    });
  });

  it("singularises a single overdue item", () => {
    const section: AgendaStickySection = { id: "overdue", kind: "overdue", tone: "warn", count: 1 };
    expect(agendaStickyFace(section, now).subtitle).toBe("item");
  });

  it("names tomorrow instead of the weekday", () => {
    const section: AgendaStickySection = {
      id: "2026-09-14",
      kind: "day",
      tone: "faint",
      count: 3,
      date: new Date("2026-09-14T09:00:00"),
    };
    expect(agendaStickyFace(section, now)).toEqual({
      numeral: "14",
      kicker: "Tomorrow",
      subtitle: "September",
    });
  });

  it("uses the weekday and keeps the year off until it changes", () => {
    const section: AgendaStickySection = {
      id: "2026-10-02",
      kind: "day",
      tone: "faint",
      count: 1,
      date: new Date("2026-10-02T09:00:00"),
    };
    expect(agendaStickyFace(section, now)).toEqual({
      numeral: "2",
      kicker: "Friday",
      subtitle: "October",
    });
  });

  it("adds the year once the horizon crosses New Year", () => {
    const section: AgendaStickySection = {
      id: "2027-01-04",
      kind: "day",
      tone: "faint",
      count: 2,
      date: new Date("2027-01-04T09:00:00"),
    };
    expect(agendaStickyFace(section, now).subtitle).toBe("January 2027");
  });

  it("keeps Later from looking like a date", () => {
    const section: AgendaStickySection = { id: "later", kind: "later", tone: "faint", count: 8 };
    expect(agendaStickyFace(section, now)).toEqual({
      numeral: null,
      kicker: "Later",
      subtitle: "8 more",
    });
  });
});
