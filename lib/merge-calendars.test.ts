import { describe, expect, it } from "vitest";
import { mergeCalendars, type CalendarSnapshot } from "./merge-calendars";
import { tombKey } from "./tombstones";
import type { Item, UserSettings } from "./types";

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

const EARLY = "2026-09-01T10:00:00.000Z";
const LATE = "2026-09-01T12:00:00.000Z";

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

function item(over: Partial<Item> & { id: string }): Item {
  return {
    categoryId: "c",
    type: "task",
    title: "Item",
    at: "2026-09-05T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("mergeCalendars", () => {
  it("lets local win on the same id when neither side is timestamped", () => {
    const merged = mergeCalendars(
      snap({ items: [item({ id: "a", title: "Local" })] }),
      snap({ items: [item({ id: "a", title: "Cloud" })] })
    );
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe("Local");
  });

  it("dedupes imported items by sourceUid", () => {
    const merged = mergeCalendars(
      snap({
        items: [
          item({ id: "local-1", type: "assignment", title: "Essay (edited)", sourceUid: "uid-1" }),
        ],
      }),
      snap({ items: [item({ id: "cloud-1", type: "assignment", title: "Essay", sourceUid: "uid-1" })] })
    );
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe("Essay (edited)");
  });

  it("keeps the cloud twin's progress when collapsing a duplicated feed item", () => {
    const merged = mergeCalendars(
      snap({
        items: [item({ id: "local-1", sourceUid: "uid-1", updatedAt: EARLY })],
      }),
      snap({
        items: [
          item({ id: "cloud-1", sourceUid: "uid-1", status: "done", updatedAt: LATE }),
        ],
      })
    );
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].id).toBe("local-1");
    expect(merged.items[0].status).toBe("done");
  });

  // --- last-write-wins -------------------------------------------------

  it("takes the newer edit even when it is the cloud's", () => {
    const merged = mergeCalendars(
      snap({ items: [item({ id: "a", title: "Stale local", updatedAt: EARLY })] }),
      snap({ items: [item({ id: "a", title: "Fresh cloud", updatedAt: LATE })] })
    );
    expect(merged.items[0].title).toBe("Fresh cloud");
  });

  it("takes the newer edit when it is the local one", () => {
    const merged = mergeCalendars(
      snap({ items: [item({ id: "a", title: "Fresh local", updatedAt: LATE })] }),
      snap({ items: [item({ id: "a", title: "Stale cloud", updatedAt: EARLY })] })
    );
    expect(merged.items[0].title).toBe("Fresh local");
  });

  it("breaks an exact tie in favour of the further-along status", () => {
    const merged = mergeCalendars(
      snap({ items: [item({ id: "a", status: "todo", updatedAt: EARLY })] }),
      snap({ items: [item({ id: "a", status: "done", updatedAt: EARLY })] })
    );
    expect(merged.items[0].status).toBe("done");
  });

  // --- tombstones ------------------------------------------------------

  it("keeps an item deleted instead of resurrecting it from the other side", () => {
    const merged = mergeCalendars(
      snap({ items: [] }),
      snap({ items: [item({ id: "a", updatedAt: EARLY })] }),
      { [tombKey("item", "a")]: LATE }
    );
    expect(merged.items).toEqual([]);
  });

  it("revives an item edited after it was deleted", () => {
    const merged = mergeCalendars(
      snap({ items: [item({ id: "a", title: "Back", updatedAt: LATE })] }),
      snap({ items: [] }),
      { [tombKey("item", "a")]: EARLY }
    );
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].title).toBe("Back");
  });

  it("applies tombstones to categories and import sources too", () => {
    const merged = mergeCalendars(
      snap({}),
      snap({
        categories: [{ id: "cat", name: "Old", color: "#000", updatedAt: EARLY }],
        importSources: [
          {
            id: "src",
            url: "https://example.com/f.ics",
            name: "Feed",
            addedAt: EARLY,
            lastSyncedAt: EARLY,
            itemCount: 0,
            updatedAt: EARLY,
          },
        ],
      }),
      { [tombKey("category", "cat")]: LATE, [tombKey("import_source", "src")]: LATE }
    );
    expect(merged.categories).toEqual([]);
    expect(merged.importSources).toEqual([]);
  });

  // --- settings --------------------------------------------------------

  it("takes the newer settings rather than always keeping local", () => {
    const merged = mergeCalendars(
      snap({ settings: { ...settings, preset: "minimal", updatedAt: EARLY } }),
      snap({ settings: { ...settings, preset: "midnight", updatedAt: LATE } })
    );
    expect(merged.settings.preset).toBe("midnight");
  });

  it("keeps local settings when they are the newer ones", () => {
    const merged = mergeCalendars(
      snap({ settings: { ...settings, preset: "noir", updatedAt: LATE } }),
      snap({ settings: { ...settings, preset: "midnight", updatedAt: EARLY } })
    );
    expect(merged.settings.preset).toBe("noir");
  });

  // --- feeds -----------------------------------------------------------

  it("collapses the same feed subscribed separately on two devices", () => {
    const base = {
      url: "https://example.com/f.ics",
      name: "Feed",
      addedAt: EARLY,
      itemCount: 3,
    };
    const merged = mergeCalendars(
      snap({ importSources: [{ ...base, id: "local", lastSyncedAt: EARLY, updatedAt: EARLY }] }),
      snap({ importSources: [{ ...base, id: "cloud", lastSyncedAt: LATE, updatedAt: LATE }] })
    );
    expect(merged.importSources).toHaveLength(1);
    expect(merged.importSources[0].id).toBe("cloud");
  });
});
