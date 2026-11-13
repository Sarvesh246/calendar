import { beforeEach, describe, expect, it } from "vitest";
import { useDatebookStore } from "./store";
import { sessionMinutesFor } from "./work-sessions";
import { rowToItem, toItemRow } from "./db-sync";
import { sanitizeItems } from "./sanitize-store";
import type { Item } from "./types";

const store = () => useDatebookStore.getState();

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

function weeklySeries() {
  store().addItem({
    categoryId: "cat-1",
    type: "event",
    title: "Study group",
    at: new Date(2026, 8, 7, 18, 0).toISOString(),
    endAt: new Date(2026, 8, 7, 19, 0).toISOString(),
    repeat: { freq: "weekly", until: new Date(2026, 9, 5, 23).toISOString() },
  });
  return [...store().items].sort((a, b) => +new Date(a.at) - +new Date(b.at));
}

describe("series: this and following", () => {
  beforeEach(reset);

  it("edits only the chosen occurrence and later ones", () => {
    const [a, b, c, d] = weeklySeries();
    store().updateSeriesFollowing(c.id, { title: "Study group (library)" });
    const byId = new Map(store().items.map((i) => [i.id, i]));
    expect(byId.get(a.id)!.title).toBe("Study group");
    expect(byId.get(b.id)!.title).toBe("Study group");
    expect(byId.get(c.id)!.title).toBe("Study group (library)");
    expect(byId.get(d.id)!.title).toBe("Study group (library)");
  });

  it("moves later occurrences by the same clock shift and keeps their length", () => {
    const [a, b, c] = weeklySeries();
    store().updateSeriesFollowing(b.id, {
      at: new Date(2026, 8, 14, 19, 30).toISOString(),
      endAt: new Date(2026, 8, 14, 21, 0).toISOString(),
    });
    const byId = new Map(store().items.map((i) => [i.id, i]));
    expect(new Date(byId.get(a.id)!.at).getHours()).toBe(18);
    const moved = byId.get(c.id)!;
    expect(new Date(moved.at).getHours()).toBe(19);
    expect(new Date(moved.at).getMinutes()).toBe(30);
    expect(new Date(moved.at).getDate()).toBe(21);
    expect(+new Date(moved.endAt!) - +new Date(moved.at)).toBe(90 * 60_000);
  });

  it("deletes this and following, leaving earlier ones, with tombstones and undo", () => {
    const [a, b, c, d] = weeklySeries();
    store().deleteSeriesFrom(c.id);
    expect(
      store()
        .items.map((i) => i.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(Object.keys(store().deletions).length).toBeGreaterThan(0);
    store().restoreLastDeleted();
    expect(store().items.map((i) => i.id)).toEqual(expect.arrayContaining([c.id, d.id]));
  });

  it("falls back to a plain edit for a one-off item", () => {
    const one = store().addItem({
      categoryId: "cat-1",
      type: "task",
      title: "Solo",
      at: new Date(2026, 8, 7).toISOString(),
    });
    store().updateSeriesFollowing(one.id, { title: "Solo!" });
    expect(store().items[0].title).toBe("Solo!");
  });
});

describe("planning fields", () => {
  beforeEach(reset);

  it("stores and clears priority, estimate and subtasks", () => {
    const t = store().addItem({
      categoryId: "cat-1",
      type: "assignment",
      title: "Essay",
      at: new Date(2026, 8, 20).toISOString(),
    });
    store().updateItem(t.id, {
      priority: "high",
      estimateMinutes: 120,
      subtasks: [{ id: "s1", title: "Outline", done: false }],
    });
    expect(store().items[0]).toMatchObject({ priority: "high", estimateMinutes: 120 });
    store().updateItem(t.id, { priority: "normal", estimateMinutes: undefined, subtasks: [] });
    const after = store().items[0];
    expect(after.priority).toBeUndefined();
    expect("estimateMinutes" in after).toBe(false);
    expect("subtasks" in after).toBe(false);
  });

  it("round-trips through the cloud row mapper with a stable key set", () => {
    const base: Item = {
      id: "i1",
      categoryId: "cat-1",
      type: "assignment",
      title: "Essay",
      at: "2026-09-20T12:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    const full: Item = {
      ...base,
      priority: "high",
      estimateMinutes: 90,
      subtasks: [{ id: "s", title: "Draft", done: true }],
    };
    expect(Object.keys(toItemRow(full, "u")).sort()).toEqual(
      Object.keys(toItemRow(base, "u")).sort(),
    );
    expect(toItemRow(base, "u")).toMatchObject({
      priority: null,
      estimate_minutes: null,
      subtasks: null,
    });
    const back = rowToItem(toItemRow(full, "u"));
    expect(back).toMatchObject({ priority: "high", estimateMinutes: 90 });
    expect(back.subtasks).toEqual(full.subtasks);
    expect(rowToItem(toItemRow(base, "u")).priority).toBeUndefined();
  });

  it("drops malformed planning fields on load", () => {
    const bad = {
      id: "x",
      categoryId: "cat-1",
      type: "task",
      title: "T",
      at: "2026-09-20T12:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      priority: "urgent",
      estimateMinutes: -5,
      subtasks: [{ id: "a", title: "ok", done: 1 }, { nope: true }],
    } as unknown as Item;
    const [clean] = sanitizeItems([bad]);
    expect(clean.priority).toBeUndefined();
    expect(clean.estimateMinutes).toBeUndefined();
    expect(clean.subtasks).toEqual([{ id: "a", title: "ok", done: false }]);
  });
});

describe("sessionMinutesFor", () => {
  const item = (estimateMinutes?: number) => ({ estimateMinutes }) as Item;
  it("uses the usual length with no estimate", () => {
    expect(sessionMinutesFor(item(), 0, 60)).toBe(60);
  });
  it("uses what is left of the estimate, rounded up to a quarter hour", () => {
    expect(sessionMinutesFor(item(100), 0, 60)).toBe(105);
    expect(sessionMinutesFor(item(120), 45, 60)).toBe(75);
  });
  it("caps long estimates and falls back once fully planned", () => {
    expect(sessionMinutesFor(item(600), 0, 60)).toBe(240);
    expect(sessionMinutesFor(item(60), 60, 45)).toBe(45);
  });
});
