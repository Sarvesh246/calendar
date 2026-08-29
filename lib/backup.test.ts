import { describe, expect, it } from "vitest";
import { parseBackup, serializeBackup } from "./backup";
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

describe("backup", () => {
  it("round-trips items", () => {
    const json = serializeBackup({
      categories: [{ id: "c", name: "Personal", color: "#000" }],
      items: [
        {
          id: "1",
          categoryId: "c",
          type: "task",
          title: "Hello",
          at: "2026-09-01T00:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      reminderPresets: [],
      settings,
      importSources: [],
    });
    const parsed = parseBackup(json);
    expect(parsed.items[0].title).toBe("Hello");
    expect(parsed.version).toBe(1);
  });

  it("rejects junk", () => {
    expect(() => parseBackup("{}")).toThrow();
  });
});
