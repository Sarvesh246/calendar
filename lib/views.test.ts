import { describe, expect, it } from "vitest";
import { applyViewFilter, itemMatchesView, sanitizeSavedViews, viewSummary } from "./views";
import { applyItemFilters } from "./filters";
import { sanitizeWorkspacePrefs, clampPaneWidth, PANE_MAX_WIDTH, PANE_MIN_WIDTH } from "./workspace-prefs";
import type { Item } from "./types";

const NOW = new Date(2026, 8, 16, 10, 0); // Wed, Sep 16 2026

function item(p: Partial<Item> = {}): Item {
  return {
    id: p.id ?? "i1",
    categoryId: "c1",
    type: "assignment",
    title: "Essay",
    at: new Date(2026, 8, 18, 23, 59).toISOString(),
    createdAt: NOW.toISOString(),
    status: "todo",
    ...p,
  };
}

describe("itemMatchesView", () => {
  it("filters work by status and keeps events out of a status view", () => {
    const f = { statuses: ["doing" as const] };
    expect(itemMatchesView(item({ status: "doing" }), f, NOW)).toBe(true);
    expect(itemMatchesView(item({ status: "todo" }), f, NOW)).toBe(false);
    expect(itemMatchesView(item({ status: undefined }), { statuses: ["todo"] }, NOW)).toBe(true);
    expect(itemMatchesView(item({ type: "event", status: undefined }), f, NOW)).toBe(false);
    expect(
      itemMatchesView(item({ type: "event", status: undefined }), { ...f, kinds: ["event", "assignment"] }, NOW)
    ).toBe(true);
  });

  it("limits kinds", () => {
    expect(itemMatchesView(item({ type: "task" }), { kinds: ["assignment"] }, NOW)).toBe(false);
    expect(itemMatchesView(item(), { kinds: ["assignment"] }, NOW)).toBe(true);
  });

  it("scopes 'this week' to the configured week start", () => {
    const sat = item({ at: new Date(2026, 8, 19, 12).toISOString() });
    const nextSun = item({ at: new Date(2026, 8, 20, 12).toISOString() });
    expect(itemMatchesView(sat, { range: "this-week" }, NOW, 0)).toBe(true);
    expect(itemMatchesView(nextSun, { range: "this-week" }, NOW, 0)).toBe(false);
    // Monday weeks run Sep 14–20, so Sunday the 20th is still this week.
    expect(itemMatchesView(nextSun, { range: "this-week" }, NOW, 1)).toBe(true);
  });

  it("counts an event overlapping the window", () => {
    const spanning = item({
      type: "event",
      status: undefined,
      at: new Date(2026, 8, 15, 20).toISOString(),
      endAt: new Date(2026, 8, 16, 1).toISOString(),
    });
    expect(itemMatchesView(spanning, { range: "today" }, NOW)).toBe(true);
  });

  it("treats done work as not overdue", () => {
    const late = item({ at: new Date(2026, 8, 10).toISOString() });
    expect(itemMatchesView(late, { range: "overdue" }, NOW)).toBe(true);
    expect(itemMatchesView({ ...late, status: "done" }, { range: "overdue" }, NOW)).toBe(false);
  });
});

describe("applyViewFilter / applyItemFilters", () => {
  it("returns the same array when the view narrows nothing", () => {
    const items = [item()];
    expect(applyViewFilter(items, { range: "any" }, NOW)).toBe(items);
    expect(applyItemFilters(items, { categoryFilter: null, viewFilter: null })).toBe(items);
  });

  it("stacks the view on top of the class filter", () => {
    const items = [item({ id: "a", status: "doing" }), item({ id: "b", status: "doing", categoryId: "c2" })];
    const out = applyItemFilters(items, {
      categoryFilter: ["c1"],
      viewFilter: { statuses: ["doing"] },
      now: NOW,
    });
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("sanitizeSavedViews", () => {
  it("drops malformed rows and unknown values", () => {
    const out = sanitizeSavedViews([
      { id: "v1", name: "  Mine  ", statuses: ["doing", "bogus"], kinds: ["task"], range: "soon" },
      { id: "v1", name: "duplicate" },
      { id: "", name: "no id" },
      { id: "v2", name: "" },
      null,
      { id: "v3", name: "Classes", categoryIds: ["c1", 4, "c1"], builtIn: true },
    ]);
    expect(out).toEqual([
      { id: "v1", name: "Mine", statuses: ["doing"], kinds: ["task"] },
      { id: "v3", name: "Classes", categoryIds: ["c1"] },
    ]);
    expect(sanitizeSavedViews("nope")).toEqual([]);
  });

  it("summarises a view", () => {
    expect(viewSummary({ id: "x", name: "x", statuses: ["doing"], range: "this-week", categoryIds: ["a", "b"] })).toBe(
      "In progress · This week · 2 classes"
    );
    expect(viewSummary({ id: "x", name: "x" })).toBe("Everything");
  });
});

describe("workspace prefs", () => {
  it("clamps the pane width and falls back on garbage", () => {
    expect(clampPaneWidth(10)).toBe(PANE_MIN_WIDTH);
    expect(clampPaneWidth(9999)).toBe(PANE_MAX_WIDTH);
    expect(clampPaneWidth("wide")).toBe(352);
  });

  it("repairs persisted prefs", () => {
    const out = sanitizeWorkspacePrefs({
      calendarMode: "year",
      paneWidth: 420,
      paneCollapsed: "yes",
      paneTab: "plan",
      assistantDocked: false,
      agendaLayout: "rows",
      sessionMinutes: 45,
      savedViews: [{ id: "v", name: "V" }],
    });
    expect(out).toEqual({
      calendarMode: "month",
      paneWidth: 420,
      paneCollapsed: false,
      paneTab: "plan",
      assistantDocked: false,
      agendaLayout: "rows",
      sessionMinutes: 60,
      savedViews: [{ id: "v", name: "V" }],
    });
  });
});
