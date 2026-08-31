import { describe, expect, it } from "vitest";
import { parseIcs, expandRRule, serializeIcs } from "./ics";

describe("expandRRule", () => {
  it("expands weekly BYDAY for a few occurrences", () => {
    const starts = expandRRule(
      new Date(2026, 8, 1, 14, 0, 0).toISOString(),
      "FREQ=WEEKLY;COUNT=4;BYDAY=TU",
      [],
      new Date(2027, 0, 1)
    );
    expect(starts.length).toBe(4);
  });

  it("skips EXDATE days", () => {
    const start = new Date(2026, 8, 1, 9, 0, 0);
    const ex = new Date(2026, 8, 2, 9, 0, 0).toISOString();
    const starts = expandRRule(start.toISOString(), "FREQ=DAILY;COUNT=3", [ex], new Date(2027, 0, 1));
    expect(starts.length).toBe(2);
  });
});

describe("parseIcs", () => {
  it("expands a weekly RRULE into instances with unique uids", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:class-1",
      "SUMMARY:Lab",
      "DTSTART:20260901T140000",
      "DTEND:20260901T150000",
      "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=TU",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics);
    expect(events.length).toBe(3);
    expect(new Set(events.map((e) => e.uid)).size).toBe(3);
  });

  it("still parses a one-off Canvas-style event", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:asg-1",
      "SUMMARY:Essay 1 [ENGL 101]",
      "DTSTART:20260902T235900",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].uid).toBe("asg-1");
  });

  it("parses VTODO with DUE as a task", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTODO",
      "UID:todo-1",
      "SUMMARY:Buy milk",
      "DUE:20260905",
      "STATUS:NEEDS-ACTION",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const { events } = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("todo");
    expect(events[0].summary).toBe("Buy milk");
  });
});

describe("serializeIcs", () => {
  it("emits a vcalendar with the item title", () => {
    const text = serializeIcs([
      {
        id: "abc",
        title: "Dentist",
        at: "2026-09-03T18:00:00.000Z",
      },
    ]);
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("SUMMARY:Dentist");
  });
});
