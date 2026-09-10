import { describe, expect, it } from "vitest";
import {
  buildAssistantDigest,
  localAnswer,
  selectAssistantItems,
  toAssistantSlimItem,
} from "./ai-assistant";
import type { Item } from "./types";

const cat = [{ id: "c1", name: "Bio" }];

function item(over: Partial<Item>): Item {
  return {
    id: over.id ?? "i",
    categoryId: "c1",
    type: "assignment",
    title: "Lab",
    at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: "todo",
    ...over,
  };
}

describe("buildAssistantDigest", () => {
  it("does not count done work as overdue or due", () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const digest = buildAssistantDigest(
      [item({ id: "d1", at: past, status: "done" })],
      cat,
      new Date().toISOString(),
      "UTC",
      0
    );
    expect(digest.overdue).toHaveLength(0);
    expect(digest.dueByNextSunday.every((e) => e.id !== "d1")).toBe(true);
  });

  it("uses completedAt for the finished list", () => {
    const digest = buildAssistantDigest(
      [
        item({
          id: "d1",
          status: "done",
          at: "2020-01-01T00:00:00.000Z",
          completedAt: new Date().toISOString(),
        }),
      ],
      cat,
      new Date().toISOString(),
      "UTC",
      0
    );
    expect(digest.completedLast7Days.count).toBe(1);
  });

  it("lists open syllabus work due on or before the coming Sunday, including overdue", () => {
    const now = "2026-09-10T18:00:00.000Z"; // Thursday
    const digest = buildAssistantDigest(
      [
        item({
          id: "overdue",
          title: "Quiz 1",
          at: "2026-09-08T23:59:00.000Z",
          sourceUid: "syl:2026-09-08:q1",
        }),
        item({
          id: "sat",
          title: "HW 3",
          at: "2026-09-12T23:59:00.000Z",
          sourceUid: "canvas-uid-hw3",
        }),
        item({
          id: "mon",
          title: "Essay",
          at: "2026-09-14T23:59:00.000Z",
        }),
        item({
          id: "done",
          title: "Finished lab",
          at: "2026-09-11T23:59:00.000Z",
          status: "done",
        }),
        item({
          id: "doing",
          title: "Lab report",
          at: "2026-09-13T23:59:00.000Z",
          status: "doing",
        }),
      ],
      cat,
      now,
      "UTC",
      0
    );
    expect(digest.dueByNextSunday.map((e) => e.id)).toEqual(["overdue", "sat", "doing"]);
    expect(digest.overdue.map((e) => e.id)).toEqual(["overdue"]);
  });
});

describe("selectAssistantItems", () => {
  it("keeps due-by-Sunday work even when hundreds of class meetings are nearer", () => {
    const now = new Date("2026-09-10T18:00:00.000Z");
    const events: Item[] = Array.from({ length: 220 }, (_, i) =>
      item({
        id: `ev-${i}`,
        type: "event",
        title: `Lecture ${i}`,
        status: undefined,
        at: new Date(now.getTime() - (110 - i) * 3_600_000).toISOString(),
        endAt: new Date(now.getTime() - (110 - i) * 3_600_000 + 3_000_000).toISOString(),
        repeat: { freq: "weekly", byDay: [1, 3, 5] },
      })
    );
    const hw = item({
      id: "hw-sun",
      title: "Problem set",
      at: "2026-09-13T23:59:00.000Z",
      sourceUid: "syl:2026-09-13:pset",
    });
    const picked = selectAssistantItems([...events, hw], now.toISOString(), "UTC", 180);
    expect(picked.some((i) => i.id === "hw-sun")).toBe(true);
    expect(toAssistantSlimItem(hw).sourceUid).toBe("syl:2026-09-13:pset");
  });
});

describe("localAnswer due by Sunday", () => {
  const now = new Date("2026-09-10T18:00:00.000Z");
  const ctx = {
    categories: cat,
    clock24h: false,
    weekStartsOn: 0 as const,
    items: [
      item({
        id: "hw",
        title: "Problem set 4",
        at: "2026-09-12T23:59:00.000Z",
      }),
    ],
  };

  it("lists remaining open work instead of treating it as a Sunday-only day", () => {
    const res = localAnswer("what's due by Sunday?", ctx, now);
    expect(res.text.toLowerCase()).toContain("problem set 4");
    expect(res.text.toLowerCase()).not.toMatch(/nothing/);
  });

  it("does not count completed work as still due", () => {
    const res = localAnswer(
      "what's due by Sunday?",
      {
        ...ctx,
        items: [item({ id: "hw", title: "Problem set 4", at: "2026-09-12T23:59:00.000Z", status: "done" })],
      },
      now
    );
    expect(res.text.toLowerCase()).toMatch(/nothing/);
  });
});
