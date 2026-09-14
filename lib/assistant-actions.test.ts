import { describe, expect, it } from "vitest";
import { exactFind, isPureQuestion, normalizeActions } from "./assistant-actions";
import type { SlimItem } from "./assistant-actions";

const items: SlimItem[] = [
  { id: "1", title: "Bio lab", type: "assignment", at: "2026-09-01T23:59:00.000Z" },
  { id: "2", title: "Chem lab", type: "assignment", at: "2026-09-02T23:59:00.000Z" },
];

const body = {
  message: "move lab",
  now: "2026-08-29T12:00:00.000Z",
  timeZone: "UTC",
  items,
  categories: [{ id: "c", name: "Science" }],
};

describe("exactFind", () => {
  it("requires a unique exact title", () => {
    expect(exactFind(items, "bio lab")?.id).toBe("1");
    expect(exactFind(items, "lab")).toBeUndefined();
  });
});

describe("normalizeActions", () => {
  it("does not update from a substring title", () => {
    const out = normalizeActions(
      [{ kind: "update", summary: "Move lab", title: "lab", at: "2026-09-05T23:59:00.000Z" }],
      body
    );
    expect(out).toHaveLength(0);
  });

  it("updates by itemId", () => {
    const out = normalizeActions(
      [{ kind: "update", summary: "Move", itemId: "1", at: "2026-09-05T23:59:00.000Z" }],
      body
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("update");
  });

  it("does not treat an empty string as a field wipe", () => {
    const out = normalizeActions(
      [{ kind: "update", summary: "Move", itemId: "1", at: "2026-09-05T23:59:00.000Z", location: "" }],
      body
    );
    expect(out[0].kind === "update" && out[0].patch.location).toBeUndefined();
  });

  it("copies several reminders onto a create and leaves omitted as default", () => {
    const withBoth = normalizeActions(
      [
        {
          kind: "create",
          summary: "Add Hullabaloo U meeting",
          title: "Hullabaloo U meeting",
          itemType: "event",
          at: "2026-09-13T17:30:00.000Z",
          location: "PLNK Building First floor by the starbucks",
          reminders: [{ offsetMinutes: 1440 }, { offsetMinutes: 120, label: "2 hours before" }],
        },
      ],
      body
    );
    expect(withBoth).toHaveLength(1);
    expect(withBoth[0].kind === "create" && withBoth[0].draft.location).toMatch(/PLNK/);
    expect(
      withBoth[0].kind === "create" &&
        withBoth[0].draft.reminders?.map((r) => r.offsetMinutes).sort((a, b) => a - b)
    ).toEqual([120, 1440]);

    const omitted = normalizeActions(
      [{ kind: "create", summary: "Add gym", title: "Gym", itemType: "event", at: "2026-09-13T18:00:00.000Z" }],
      body
    );
    expect(omitted[0].kind === "create" && omitted[0].draft.reminders).toBeUndefined();

    const none = normalizeActions(
      [
        {
          kind: "create",
          summary: "Add gym",
          title: "Gym",
          itemType: "event",
          at: "2026-09-13T18:00:00.000Z",
          reminders: [],
        },
      ],
      body
    );
    expect(none[0].kind === "create" && none[0].draft.reminders).toEqual([]);
  });

  it("attaches a weekly class-meeting repeat on create", () => {
    const out = normalizeActions(
      [
        {
          kind: "create",
          summary: "Add lecture",
          title: "ENGL 101",
          itemType: "event",
          at: "2026-09-14T15:00:00.000Z",
          endAt: "2026-09-14T15:50:00.000Z",
          repeatFreq: "weekly",
          repeatDays: [1, 3, 5],
          until: "2026-12-12T23:59:00.000Z",
        },
      ],
      body
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind === "create" && out[0].draft.repeat).toEqual({
      freq: "weekly",
      byDay: [1, 3, 5],
      until: "2026-12-12T23:59:00.000Z",
    });
  });
});

describe("isPureQuestion", () => {
  it("detects questions vs mutations", () => {
    expect(isPureQuestion("what's due friday?")).toBe(true);
    expect(isPureQuestion("move the essay to sunday")).toBe(false);
    expect(isPureQuestion("can you put my Hullabaloo meeting at 5:30")).toBe(false);
    expect(isPureQuestion("I have a meeting at 5:30 at PLNK, ping me the day before")).toBe(false);
  });
});
