import { describe, expect, it } from "vitest";
import { buildAssistantDigest } from "./ai-assistant";
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
});
