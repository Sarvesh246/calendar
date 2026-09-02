import { beforeEach, describe, expect, it } from "vitest";
import { useDatebookStore } from "./store";
import { mergeCalendars, type CalendarSnapshot } from "./merge-calendars";
import { tombKey, time } from "./tombstones";
import type { Item, UserSettings } from "./types";

/** Reset to a known empty calendar without going through `resetAllData` (which
 *  deliberately writes tombstones of its own). */
function reset() {
  useDatebookStore.setState({
    items: [],
    categories: [{ id: "cat-1", name: "Personal", color: "#34C759" }],
    importSources: [],
    deletions: {},
    lastDeleted: null,
    mode: "local",
    userId: null,
  });
}

const store = () => useDatebookStore.getState();

function addTask(title: string): Item {
  return store().addItem({
    categoryId: "cat-1",
    type: "assignment",
    title,
    at: "2026-09-10T17:00:00.000Z",
  });
}

/** Stand in for the other device's copy of the calendar. */
function cloudWith(items: Item[]): CalendarSnapshot {
  return {
    categories: store().categories,
    items,
    reminderPresets: store().reminderPresets,
    importSources: [],
    settings: store().settings as UserSettings,
  };
}

function localSnapshot(): CalendarSnapshot {
  const s = store();
  return {
    categories: s.categories,
    items: s.items,
    reminderPresets: s.reminderPresets,
    importSources: s.importSources,
    settings: s.settings,
  };
}

beforeEach(reset);

describe("edit timestamps", () => {
  it("stamps a new item and moves the stamp on every edit", async () => {
    const item = addTask("Lab report");
    expect(item.updatedAt).toBe(item.createdAt);

    await new Promise((r) => setTimeout(r, 5));
    store().updateItem(item.id, { title: "Lab report v2" });
    const edited = store().items[0];
    expect(edited.title).toBe("Lab report v2");
    expect(time(edited.updatedAt)).toBeGreaterThan(time(item.updatedAt));
  });

  it("moves the stamp when the status changes", async () => {
    const item = addTask("Reading");
    await new Promise((r) => setTimeout(r, 5));
    store().toggleItemDone(item.id);
    const done = store().items[0];
    expect(done.status).toBe("done");
    expect(time(done.updatedAt)).toBeGreaterThan(time(item.updatedAt));
  });
});

describe("status timestamps", () => {
  it("stamps statusAt only when the status actually changes", async () => {
    const item = addTask("Quiz");
    expect(item.statusAt).toBeUndefined();

    store().toggleItemDone(item.id);
    const done = store().items[0];
    expect(done.status).toBe("done");
    expect(done.statusAt).toBeTypeOf("string");

    await new Promise((r) => setTimeout(r, 5));
    // A content-only edit must leave the status clock alone, or a feed refresh
    // would keep re-winning the status merge.
    store().updateItem(item.id, { description: "chapters 1-3" });
    const edited = store().items[0];
    expect(edited.statusAt).toBe(done.statusAt);
    expect(time(edited.updatedAt)).toBeGreaterThan(time(done.updatedAt));
  });

  it("moves statusAt when the status changes again", async () => {
    const item = addTask("Quiz");
    store().setItemStatus(item.id, "doing");
    const doing = store().items[0];
    await new Promise((r) => setTimeout(r, 5));
    store().setItemStatus(item.id, "done");
    const done = store().items[0];
    expect(time(done.statusAt)).toBeGreaterThan(time(doing.statusAt));
  });
});

describe("deletion tombstones", () => {
  it("records a tombstone when an item is deleted", () => {
    const item = addTask("Essay");
    store().deleteItem(item.id);
    expect(store().items).toHaveLength(0);
    expect(store().deletions[tombKey("item", item.id)]).toBeTypeOf("string");
  });

  it("keeps the item deleted when the other device still has it", () => {
    const item = addTask("Essay");
    store().deleteItem(item.id);

    // The other device never saw the delete and still holds the row.
    const merged = mergeCalendars(localSnapshot(), cloudWith([item]), store().deletions);
    expect(merged.items).toHaveLength(0);
  });

  it("brings the item back on undo, and undo survives the next merge", () => {
    const item = addTask("Essay");
    store().deleteItem(item.id);
    store().restoreLastDeleted();

    expect(store().items).toHaveLength(1);
    expect(store().deletions[tombKey("item", item.id)]).toBeUndefined();

    const merged = mergeCalendars(localSnapshot(), cloudWith([item]), store().deletions);
    expect(merged.items).toHaveLength(1);
  });

  it("tombstones every item when all data is reset", () => {
    const a = addTask("A");
    const b = addTask("B");
    store().resetAllData();
    expect(store().items).toHaveLength(0);

    const merged = mergeCalendars(localSnapshot(), cloudWith([a, b]), store().deletions);
    expect(merged.items).toHaveLength(0);
  });

  it("tombstones a whole recurring series", () => {
    const first = store().addItem({
      categoryId: "cat-1",
      type: "event",
      title: "Lecture",
      at: "2026-09-10T17:00:00.000Z",
      repeat: { freq: "weekly", interval: 1, until: "2026-10-01T17:00:00.000Z" },
    });
    const series = store().items;
    expect(series.length).toBeGreaterThan(1);

    store().deleteSeries(first.repeatId!);
    expect(store().items).toHaveLength(0);

    const merged = mergeCalendars(localSnapshot(), cloudWith(series), store().deletions);
    expect(merged.items).toHaveLength(0);
  });
});

describe("cross-device edits", () => {
  it("keeps the other device's newer edit instead of the local stale one", () => {
    const item = addTask("Problem set");
    // Same row, edited later elsewhere.
    const remote: Item = {
      ...item,
      title: "Problem set (rescheduled)",
      updatedAt: new Date(time(item.updatedAt) + 60_000).toISOString(),
    };
    const merged = mergeCalendars(localSnapshot(), cloudWith([remote]), {});
    expect(merged.items[0].title).toBe("Problem set (rescheduled)");
  });

  it("keeps the local edit when it is the newer one", () => {
    const item = addTask("Problem set");
    const stale: Item = {
      ...item,
      title: "Old title",
      updatedAt: new Date(time(item.updatedAt) - 60_000).toISOString(),
    };
    const merged = mergeCalendars(localSnapshot(), cloudWith([stale]), {});
    expect(merged.items[0].title).toBe("Problem set");
  });

  it("does not resurrect a row the other device deleted", () => {
    const item = addTask("Quiz");
    // Cloud no longer has it, and carries the tombstone explaining why.
    const merged = mergeCalendars(localSnapshot(), cloudWith([]), {
      [tombKey("item", item.id)]: new Date(time(item.updatedAt) + 1000).toISOString(),
    });
    expect(merged.items).toHaveLength(0);
  });
});

describe("settings", () => {
  it("stamps settings changes so the newer device wins", async () => {
    const before = store().settings.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    store().updateSettings({ preset: "noir" });
    const after = store().settings;
    expect(after.preset).toBe("noir");
    expect(time(after.updatedAt)).toBeGreaterThan(time(before));

    // An older copy from the other device must not revert it.
    const stale: UserSettings = {
      ...after,
      preset: "minimal",
      updatedAt: new Date(time(after.updatedAt) - 60_000).toISOString(),
    };
    const merged = mergeCalendars(localSnapshot(), { ...cloudWith([]), settings: stale }, {});
    expect(merged.settings.preset).toBe("noir");
  });
});
