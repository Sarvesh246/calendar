import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockTimes,
  findMissingDetails,
  placePhrases,
  reminderOffsets,
} from "./assistant-completeness";
import { findPossibleDuplicate, similarTitles } from "./duplicates";

const NY = "America/New_York";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T23:30:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("what the message said", () => {
  it("finds a place phrase, with its tail, and ignores times and days", () => {
    expect(placePhrases("dentist next tuesday 3pm at the clinic on main st")).toEqual([
      "the clinic on main st",
    ]);
    expect(placePhrases("gym at 6pm tomorrow")).toEqual([]);
    expect(placePhrases("lunch at noon")).toEqual([]);
  });

  it("a place ends where the next clause begins", () => {
    expect(placePhrases("meet at the library and bring notes")).toEqual(["the library"]);
    expect(placePhrases("study at the library with a reminder an hour before")).toEqual([
      "the library",
    ]);
  });

  it("recognizes explicit lowercase and bare room locations", () => {
    expect(placePhrases("parents weekend location kyle field")).toEqual(["kyle field"]);
    expect(placePhrases("review thursday 6-8pm ZACH 350")).toEqual(["ZACH 350"]);
  });

  it("finds clock times, but not the time of a reminder", () => {
    expect(clockTimes("dentist tuesday 3pm and call mom at 4:30 pm")).toEqual([900, 990]);
    expect(clockTimes("remind me at 5pm to call mom tomorrow")).toEqual([]);
  });

  it("finds reminder offsets in minutes", () => {
    expect(
      reminderOffsets("a reminder a day before and 30 minutes before and 2 hours before"),
    ).toEqual([1440, 30, 120]);
    expect(reminderOffsets("no reminders here")).toEqual([]);
  });
});

describe("findMissingDetails", () => {
  const dentist = {
    kind: "create",
    title: "Dentist",
    // Tue Nov 17, 3pm New York.
    at: "2026-11-17T20:00:00.000Z",
  };

  it("flags the location the model dropped — the audit's dentist case", () => {
    const missing = findMissingDetails(
      "dentist next tuesday 3pm at the clinic on main st",
      [dentist],
      NY,
    );
    expect(missing).toEqual(['location "the clinic on main st"']);
  });

  it("is satisfied once the location is on the item", () => {
    const kept = { ...dentist, location: "The clinic on Main St" };
    expect(
      findMissingDetails("dentist next tuesday 3pm at the clinic on main st", [kept], NY),
    ).toEqual([]);
  });

  it("accepts words retained in a title or class and ignores check in", () => {
    expect(
      findMissingDetails(
        "add homework 3 in CSCE 221 due friday",
        [{ kind: "create", title: "Homework 3", categoryId: "cs" }],
        NY,
        new Date(),
        [{ id: "cs", name: "CSCE 221" }],
      ),
    ).toEqual([]);
    expect(
      findMissingDetails(
        "schedule a check in with my advisor next tuesday at 3pm",
        [{ ...dentist, title: "Check in with my advisor" }],
        NY,
      ),
    ).toEqual([]);
    expect(placePhrases("meeting in person at 3pm")).toEqual([]);
  });

  it("checks repeat range against until and rejects a months-long occurrence", () => {
    const msg = "add CHEM 107 lecture mondays and wednesdays 10am to 11am from sep 28 to dec 1";
    const series = {
      kind: "create",
      at: "2026-09-28T14:00:00Z",
      endAt: "2026-09-28T15:00:00Z",
      repeatFreq: "weekly",
      until: "2026-12-02T04:59:00Z",
    };
    const now = new Date(2026, 8, 1);
    expect(findMissingDetails(msg, [series], NY, now)).toEqual([]);
    expect(
      findMissingDetails(msg, [{ ...series, endAt: "2026-12-01T16:00:00Z" }], NY, now),
    ).not.toEqual([]);
  });

  it("flags a time that no staged item has", () => {
    const wrong = { ...dentist, at: "2026-11-17T21:00:00.000Z" }; // 4pm
    expect(findMissingDetails("dentist next tuesday 3pm", [wrong], NY)).toEqual(["time 3:00 PM"]);
  });

  it("flags a reminder that was dropped", () => {
    const missing = findMissingDetails(
      "dentist tuesday 3pm with a reminder a day before and an hour before",
      [{ ...dentist, reminders: [{ offsetMinutes: 1440 }] }],
      NY,
    );
    expect(missing).toEqual(["reminder 1 hour(s) before"]);
  });

  it("counts a detail kept by any one of several staged adds", () => {
    const lab = { kind: "create", title: "Lab report", at: "2026-11-15T23:59:00.000Z" };
    const study = {
      kind: "create",
      title: "Study group",
      at: "2026-11-13T00:00:00.000Z", // Thu 7pm NY
      location: "The library",
    };
    expect(
      findMissingDetails(
        "add study group thursday 7pm at the library and lab report due sunday",
        [study, lab],
        NY,
      ),
    ).toEqual([]);
  });

  it("requires an explicit date range on one event", () => {
    const oneDay = { kind: "create", at: "2026-11-14T05:00:00Z", allDay: true };
    expect(findMissingDetails("add hackathon nov 14-16", [oneDay], NY)).toContain(
      'date range "nov 14-16" on one event',
    );
    expect(
      findMissingDetails(
        "add hackathon nov 14-16",
        [{ ...oneDay, endAt: "2026-11-17T05:00:00Z" }],
        NY,
      ),
    ).toEqual([]);
  });
  it("recognizes a lowercase place", () => {
    expect(
      findMissingDetails(
        "meeting tomorrow at zachry",
        [{ kind: "create", title: "Meeting", at: "2026-11-11T15:00:00Z" }],
        NY,
      ),
    ).toContain('location "zachry"');
  });

  it("only judges turns that are all adds", () => {
    expect(findMissingDetails("delete the 7pm study group", [{ kind: "delete" }], NY)).toEqual([]);
    expect(
      findMissingDetails(
        "move gym to 7pm",
        [{ kind: "update", at: "2026-11-13T00:00:00.000Z" }],
        NY,
      ),
    ).toEqual([]);
  });

  it("says nothing when the message had nothing to keep", () => {
    expect(findMissingDetails("add dentist tomorrow", [dentist], NY)).toEqual([]);
  });
});

describe("duplicates", () => {
  it("treats 'Study group' and 'Study group meeting' as the same thing", () => {
    expect(similarTitles("Study group", "Study group meeting")).toBe(true);
    expect(similarTitles("Study group", "Dentist")).toBe(false);
    expect(similarTitles("", "x")).toBe(false);
  });

  const existing = [
    { id: "sg", title: "Study group meeting", at: "2026-11-13T00:00:00.000Z" },
    { id: "far", title: "Study group", at: "2026-11-20T00:00:00.000Z" },
  ];

  it("finds one within two hours — the audit's silent duplicate", () => {
    expect(
      findPossibleDuplicate(existing, { title: "Study group", at: "2026-11-13T01:00:00.000Z" })?.id,
    ).toBe("sg");
  });

  it("ignores the same title on another day, or a different thing at the same time", () => {
    expect(
      findPossibleDuplicate(existing, { title: "Study group", at: "2026-11-14T00:00:00.000Z" }),
    ).toBeNull();
    expect(
      findPossibleDuplicate(existing, { title: "Dentist", at: "2026-11-13T00:00:00.000Z" }),
    ).toBeNull();
  });
});
