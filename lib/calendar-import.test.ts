import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./calendar-import";
import { mergeImportedItem, snapshotFrom } from "./source-snapshot";
import type { Item } from "./types";

describe("buildImportPlan", () => {
  it("creates a category from a Canvas-style [COURSE] suffix", () => {
    const plan = buildImportPlan(
      {
        calendarName: "Canvas",
        events: [
          {
            uid: "a1",
            summary: "Essay 1 [ENGL 101]",
            start: "2026-09-02T23:59:00.000Z",
            allDay: false,
          },
        ],
      },
      [],
      "source-1"
    );
    expect(plan.newCategories).toHaveLength(1);
    expect(plan.newCategories[0].name).toBe("ENGL 101");
    expect(plan.drafts[0].title).toBe("Essay 1");
    expect(plan.drafts[0].type).toBe("assignment");
  });
});

describe("mergeImportedItem", () => {
  it("keeps a locally edited title across re-sync", () => {
    const draft = {
      title: "Essay 1",
      type: "assignment" as const,
      categoryId: "c1",
      at: "2026-09-02T23:59:00.000Z",
      sourceId: "s",
      sourceUid: "a1",
    };
    const item: Item = {
      id: "id-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "doing",
      ...draft,
      title: "My rewrite",
      sourceSnapshot: snapshotFrom(draft),
    };
    const incoming = { ...draft, title: "Essay 1 (updated)", at: "2026-09-03T23:59:00.000Z" };
    const next = mergeImportedItem(item, incoming);
    expect(next.title).toBe("My rewrite");
    expect(next.at).toBe("2026-09-03T23:59:00.000Z");
    expect(next.status).toBe("doing");
  });
});
