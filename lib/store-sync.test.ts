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
    syncNotices: [],
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

describe("sync notices", () => {
  it("starts empty and dismisses by id", () => {
    expect(store().syncNotices).toEqual([]);
    useDatebookStore.setState({
      syncNotices: [
        { id: "n1", itemId: "a", title: "Essay", kind: "remote", rev: 0 },
        { id: "n2", itemId: "b", title: "Quiz", kind: "conflict", rev: 0 },
      ],
    });
    store().dismissSyncNotice("n1");
    expect(store().syncNotices.map((n) => n.id)).toEqual(["n2"]);
    store().clearSyncNotices();
    expect(store().syncNotices).toEqual([]);
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


describe("Canvas feed re-sync", () => {
  const FEED = "https://canvas.example/feed.ics";
  const DUE = "2026-09-05T23:59:00.000Z";
  const TICKED = "2026-09-04T10:00:00.000Z";

  /** One assignment, exactly as a Canvas feed publishes it. */
  const feed = (over: Partial<{ uid: string; summary: string }> = {}) => ({
    calendarName: "Canvas",
    events: [
      {
        uid: over.uid ?? "canvas-uid-1",
        summary: over.summary ?? "Essay 1 [ENGL 101]",
        start: DUE,
        allDay: false,
      },
    ],
  });

  const source = (id: string) => ({
    id,
    url: FEED,
    name: "Canvas",
    addedAt: "2026-09-01T00:00:00.000Z",
    lastSyncedAt: "2026-09-01T00:00:00.000Z",
    itemCount: 1,
  });

  const importedItem = (over: Partial<Item>): Item => ({
    id: "item-1",
    categoryId: "cat-1",
    type: "assignment",
    title: "Essay 1",
    at: DUE,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    sourceUid: "canvas-uid-1",
    ...over,
  });

  beforeEach(reset);

  it("re-syncing the same feed neither duplicates items nor courses", () => {
    store().applyImport(FEED, feed());
    const afterFirst = store().items.length;
    const courses = store().categories.length;
    const second = store().applyImport(FEED, feed());
    expect(store().items).toHaveLength(afterFirst);
    expect(store().categories).toHaveLength(courses);
    expect(second).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(store().importSources).toHaveLength(1);
  });

  it("leaves a completed assignment completed across a re-sync", () => {
    store().applyImport(FEED, feed());
    const imported = store().items.find((i) => i.sourceUid === "canvas-uid-1") as Item;
    store().setItemStatus(imported.id, "done");
    store().applyImport(FEED, feed());
    const after = store().items.filter((i) => i.sourceUid === "canvas-uid-1");
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("done");
  });

  it("keeps a completed assignment that has dropped out of the feed", () => {
    store().applyImport(FEED, feed());
    const imported = store().items.find((i) => i.sourceUid === "canvas-uid-1") as Item;
    store().setItemStatus(imported.id, "done");
    // Canvas stops publishing it once the term rolls over.
    store().applyImport(FEED, { calendarName: "Canvas", events: [] });
    expect(store().items.find((i) => i.id === imported.id)?.status).toBe("done");
  });

  it("claims back an item whose source row lost a dedupe", () => {
    // Two devices subscribed separately, so there were two source rows; the
    // merge collapsed them and this item is still tagged with the loser. It is
    // the same Canvas event, so importing it again must not mint a second copy
    // — which is how a ticked-off assignment reappeared as todo and overdue.
    useDatebookStore.setState({
      importSources: [source("src-live")],
      items: [
        importedItem({
          sourceId: "src-dead",
          status: "done",
          statusAt: TICKED,
          completedAt: TICKED,
        }),
      ],
    });
    const result = store().applyImport(FEED, feed());
    const items = store().items.filter((i) => i.sourceUid === "canvas-uid-1");
    expect(result.added).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("item-1");
    expect(items[0].sourceId).toBe("src-live");
    expect(items[0].status).toBe("done");
  });

  it("collapses two rows for one feed event, keeping the tick", () => {
    useDatebookStore.setState({
      importSources: [source("src-live")],
      items: [
        importedItem({
          id: "item-done",
          sourceId: "src-live",
          status: "done",
          statusAt: TICKED,
          completedAt: TICKED,
        }),
        importedItem({ id: "item-todo", sourceId: "src-live", status: "todo" }),
      ],
    });
    const result = store().applyImport(FEED, feed());
    const items = store().items.filter((i) => i.sourceUid === "canvas-uid-1");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("done");
    expect(result.removed).toBe(1);
    // The copy that lost has to be tombstoned, or the other device pushes it back.
    expect(store().deletions[tombKey("item", "item-todo")]).toBeTruthy();
  });

  it("does not claim an item that belongs to another live feed", () => {
    useDatebookStore.setState({
      importSources: [source("src-live"), { ...source("src-other"), url: "https://other/f.ics" }],
      items: [importedItem({ id: "other-feed", sourceId: "src-other" })],
    });
    store().applyImport(FEED, feed());
    expect(store().items.find((i) => i.id === "other-feed")?.sourceId).toBe("src-other");
  });
});
