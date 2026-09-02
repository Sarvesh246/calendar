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

  it("falls back to the calendar name when the [] bracket is empty", () => {
    // `course ?? fallbackName` kept the empty string, so this minted a category
    // with no name — and a fresh one on every re-sync.
    const plan = buildImportPlan(
      {
        calendarName: "Canvas",
        events: [
          {
            uid: "a1",
            summary: "Essay 1 [ ]",
            start: "2026-09-02T23:59:00.000Z",
            allDay: false,
          },
        ],
      },
      [],
      "source-1"
    );
    expect(plan.newCategories).toHaveLength(1);
    expect(plan.newCategories[0].name).toBe("Canvas");
  });

  it("reuses a category whose name was lost instead of duplicating it", () => {
    const existing = [
      { id: "c-blank", name: "", color: "#007AFF", sourceId: "source-1" },
    ];
    const plan = buildImportPlan(
      {
        calendarName: null,
        events: [
          {
            uid: "a1",
            summary: "Reading",
            start: "2026-09-02T23:59:00.000Z",
            allDay: false,
          },
        ],
      },
      existing,
      "source-1"
    );
    expect(plan.newCategories).toHaveLength(1);
    expect(plan.newCategories[0].name).toBe("Imported");

    // A second pass over the repaired store adds nothing further.
    const repaired = [{ id: "c-blank", name: "Uncategorized", color: "#007AFF" }];
    const second = buildImportPlan(
      {
        calendarName: null,
        events: [
          {
            uid: "a1",
            summary: "Reading [Uncategorized]",
            start: "2026-09-02T23:59:00.000Z",
            allDay: false,
          },
        ],
      },
      repaired,
      "source-1"
    );
    expect(second.newCategories).toHaveLength(0);
    expect(second.drafts[0].categoryId).toBe("c-blank");
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
