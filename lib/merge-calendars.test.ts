import { describe, expect, it } from "vitest";
import { mergeCalendars, type CalendarSnapshot } from "./merge-calendars";
import type { UserSettings } from "./types";

const settings: UserSettings = {
  preset: "minimal",
  landingView: "today",
  density: "comfortable",
  weekStartsOn: 0,
  clock24h: false,
  showLocation: true,
  showCategoryDot: true,
  hideCompleted: false,
  defaultReminderPresetIds: [],
};

function snap(over: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    categories: [],
    items: [],
    reminderPresets: [],
    importSources: [],
    settings,
    ...over,
  };
}

describe("mergeCalendars", () => {
  it("lets local win on the same id", () => {
    const cloud = snap({
      items: [
        {
          id: "a",
          categoryId: "c",
          type: "task",
          title: "Cloud",
          at: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const local = snap({
      items: [
        {
          id: "a",
          categoryId: "c",
          type: "task",
          title: "Local",
          at: "2026-09-02T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    const merged = mergeCalendars(local, cloud);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe("Local");
  });

  it("dedupes imported items by sourceUid", () => {
    const cloud = snap({
      items: [
        {
          id: "cloud-1",
          categoryId: "c",
          type: "assignment",
          title: "Essay",
          at: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          sourceUid: "uid-1",
        },
      ],
    });
    const local = snap({
      items: [
        {
          id: "local-1",
          categoryId: "c",
          type: "assignment",
          title: "Essay (edited)",
          at: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          sourceUid: "uid-1",
        },
      ],
    });
    const merged = mergeCalendars(local, cloud);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe("Essay (edited)");
  });
});
