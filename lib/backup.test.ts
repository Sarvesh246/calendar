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
  mobileDayDetails: "sheet",
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

describe("parseBackup hardening", () => {
  it("strips items a restore couldn't render", () => {
    // An arbitrary file the user picked: one good item, and three that would
    // each take down every view that formats a date.
    const raw = JSON.stringify({
      version: 1,
      categories: [{ id: "c1", name: "Bio", color: "#007AFF" }, null, { name: "no id" }],
      items: [
        { id: "i1", categoryId: "c1", type: "event", title: "Lab", at: "2026-09-09T12:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "i2", categoryId: "c1", type: "event", title: "Broken", at: "nonsense", createdAt: "2026-09-01T00:00:00.000Z" },
        null,
        42,
      ],
    });
    const parsed = parseBackup(raw);
    expect(parsed.items.map((i) => i.id)).toEqual(["i1"]);
    expect(parsed.categories.map((c) => c.id)).toEqual(["c1"]);
  });

  it("still round-trips a clean export", () => {
    const parsed = parseBackup(
      serializeBackup({
        categories: [{ id: "c1", name: "Bio", color: "#007AFF" }],
        items: [
          {
            id: "i1",
            categoryId: "c1",
            type: "assignment",
            title: "Essay",
            at: "2026-09-09T12:00:00.000Z",
            createdAt: "2026-09-01T00:00:00.000Z",
            status: "todo",
          },
        ],
        reminderPresets: [],
        settings: undefined as never,
        importSources: [],
      })
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].status).toBe("todo");
    expect(parsed.categories[0].name).toBe("Bio");
  });
});
