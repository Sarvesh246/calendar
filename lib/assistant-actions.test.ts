import { describe, expect, it } from "vitest";
import {
  describeAction,
  exactFind,
  isPureQuestion,
  normalizeActions,
  resolveDraftClass,
} from "./assistant-actions";
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
      body,
    );
    expect(out).toHaveLength(0);
  });

  it("updates by itemId", () => {
    const out = normalizeActions(
      [{ kind: "update", summary: "Move", itemId: "1", at: "2026-09-05T23:59:00.000Z" }],
      body,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("update");
  });

  it("does not treat an empty string as a field wipe", () => {
    const out = normalizeActions(
      [
        {
          kind: "update",
          summary: "Move",
          itemId: "1",
          at: "2026-09-05T23:59:00.000Z",
          location: "",
        },
      ],
      body,
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
      body,
    );
    expect(withBoth).toHaveLength(1);
    expect(withBoth[0].kind === "create" && withBoth[0].draft.location).toMatch(/PLNK/);
    expect(
      withBoth[0].kind === "create" &&
        withBoth[0].draft.reminders?.map((r) => r.offsetMinutes).sort((a, b) => a - b),
    ).toEqual([120, 1440]);

    const omitted = normalizeActions(
      [
        {
          kind: "create",
          summary: "Add gym",
          title: "Gym",
          itemType: "event",
          at: "2026-09-13T18:00:00.000Z",
        },
      ],
      body,
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
      body,
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
      body,
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

describe("describeAction", () => {
  const local = (m: number, d: number, h = 0, min = 0) =>
    new Date(2026, m - 1, d, h, min).toISOString();
  const categories = [
    { id: "chem", name: "CHEM 101" },
    { id: "pols", name: "POLS 207" },
  ];
  const lab = {
    id: "lab",
    title: "Chem lab report 6",
    type: "assignment" as const,
    at: local(11, 12, 23, 59),
    status: "todo" as const,
    categoryId: "chem",
  };

  it("shows the inclusive end of a multi-day event", () => {
    const d = describeAction(
      {
        kind: "create",
        summary: "",
        draft: {
          title: "Hackathon",
          type: "event",
          categoryId: "",
          at: local(11, 14, 12),
          endAt: local(11, 17),
          allDay: true,
        },
      },
      [],
    );
    expect(d.when).toBe("Sat, Nov 14 – Mon, Nov 16 (all day)");
  });

  it("a model reschedule shows the old and new date, not just 'Update'", () => {
    const d = describeAction(
      {
        kind: "update",
        summary: "Update “Chem lab report 6”",
        itemId: "lab",
        itemTitle: lab.title,
        patch: { at: local(11, 14, 23, 59) },
      },
      [lab],
    );
    expect(d.verb).toBe("Reschedule");
    expect(d.changes).toEqual([{ field: "Due", from: "Thu, Nov 12", to: "Sat, Nov 14" }]);
  });

  it("an event move shows both times, in the user's clock", () => {
    const gym = { id: "g", title: "Gym", type: "event" as const, at: local(11, 12, 18) };
    const patch = { at: local(11, 13, 19) };
    const base = { kind: "update" as const, summary: "", itemId: "g", itemTitle: "Gym", patch };
    expect(describeAction(base, [gym]).changes[0]).toEqual({
      field: "When",
      from: "Thu, Nov 12 at 6:00 PM",
      to: "Fri, Nov 13 at 7:00 PM",
    });
    expect(describeAction(base, [gym], true).changes[0].to).toBe("Fri, Nov 13 at 19:00");
  });

  it("names class, status, title, location and reminder changes", () => {
    const d = describeAction(
      {
        kind: "update",
        summary: "",
        itemId: "lab",
        itemTitle: lab.title,
        patch: {
          categoryId: "pols",
          status: "done",
          title: "Lab 6",
          location: undefined,
          reminders: [{ id: "r", itemId: "lab", offsetMinutes: 60, label: "1 hour before" }],
        },
      },
      [lab],
      false,
      categories,
    );
    expect(d.verb).toBe("Complete");
    const byField = Object.fromEntries(d.changes.map((c) => [c.field, c]));
    expect(byField.Class).toEqual({ field: "Class", from: "CHEM 101", to: "POLS 207" });
    expect(byField.Status).toEqual({ field: "Status", from: "To do", to: "Done" });
    expect(byField.Title).toEqual({ field: "Title", from: "Chem lab report 6", to: "Lab 6" });
    expect(byField.Location.to).toBe("removed");
    expect(byField.Reminders.to).toBe("1 hour before");
  });

  it("a delete says which item and when it was", () => {
    const d = describeAction({ kind: "delete", summary: "", itemId: "lab", itemTitle: lab.title }, [
      lab,
    ]);
    expect(d).toMatchObject({ verb: "Delete", title: "Chem lab report 6", when: "Thu, Nov 12" });
  });

  it("a series states its count and its end", () => {
    const d = describeAction(
      {
        kind: "create",
        summary: "",
        draft: {
          title: "Gym",
          type: "event",
          categoryId: "chem",
          at: local(11, 16, 6),
          repeat: { freq: "weekly", byDay: [1, 3], until: local(11, 30, 23, 59) },
        },
      },
      [],
    );
    // Mon Nov 16, Wed 18, Mon 23, Wed 25, Mon 30.
    expect(d.series).toBe("Adds 5 events · every Monday and Wednesday until Mon, Nov 30");
  });

  it("a series with no end says so", () => {
    const d = describeAction(
      {
        kind: "create",
        summary: "",
        draft: {
          title: "Gym",
          type: "event",
          categoryId: "chem",
          at: local(11, 16, 6),
          repeat: { freq: "weekly", byDay: [1] },
        },
      },
      [],
    );
    expect(d.series).toMatch(/with no end date$/);
  });
});

describe("resolveDraftClass", () => {
  const cats = [{ id: "a" }, { id: "b" }];
  it("keeps a valid class the model named", () => {
    expect(resolveDraftClass({ categoryId: "b" }, cats, "a")).toBe("b");
  });
  it("falls to the single filtered class, then the first class", () => {
    expect(resolveDraftClass({ categoryId: "" }, cats, "b")).toBe("b");
    expect(resolveDraftClass({}, cats, null)).toBe("a");
    expect(resolveDraftClass({ categoryId: "gone" }, cats, "gone")).toBe("a");
  });
  it("is empty when there are no classes at all", () => {
    expect(resolveDraftClass({}, [], null)).toBe("");
  });
});

describe("normalizeActions — class", () => {
  it("never files an unclassed create under the first class on its own", () => {
    const out = normalizeActions(
      [{ kind: "create", title: "Study group", itemType: "event", at: "2026-11-12T19:00:00.000Z" }],
      {
        message: "",
        now: "2026-11-10T12:00:00.000Z",
        items: [],
        categories: [{ id: "chem", name: "CHEM 101" }],
      },
    );
    expect(out[0]).toMatchObject({ kind: "create", draft: { categoryId: "" } });
  });
});
