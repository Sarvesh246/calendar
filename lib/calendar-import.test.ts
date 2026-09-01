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

  it("imports VTODO feeds as tasks", () => {
    const plan = buildImportPlan(
      {
        calendarName: "Tasks",
        events: [
          {
            uid: "todo-1",
            summary: "Buy milk",
            start: "2026-09-05T12:00:00.000Z",
            allDay: true,
            kind: "todo",
          },
        ],
      },
      [],
      "source-1"
    );
    expect(plan.drafts[0].type).toBe("task");
    expect(plan.drafts[0].status).toBe("todo");
  });

  it("does not crash when an existing category has no name", () => {
    const plan = buildImportPlan(
      {
        calendarName: "Canvas",
        events: [
          {
            uid: "a1",
            summary: "Quiz [MATH 150]",
            start: "2026-09-02T23:59:00.000Z",
            allDay: false,
          },
        ],
      },
      [{ id: "broken", name: undefined as unknown as string, color: "#f00" }],
      "source-1"
    );
    expect(plan.newCategories[0].name).toBe("MATH 150");
    expect(plan.drafts).toHaveLength(1);
  });

  it("marks completed VTODO items as done", () => {
    const plan = buildImportPlan(
      {
        calendarName: "Tasks",
        events: [
          {
            uid: "todo-2",
            summary: "Done task",
            start: "2026-09-05T12:00:00.000Z",
            allDay: true,
            kind: "todo",
            todoStatus: "COMPLETED",
          },
        ],
      },
      [],
      "source-1"
    );
    expect(plan.drafts[0].status).toBe("done");
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
