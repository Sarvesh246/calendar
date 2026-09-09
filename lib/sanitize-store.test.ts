import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./calendar-import";
import {
  sanitizeCategories,
  sanitizeItems,
  sanitizeReminderPresets,
  sanitizeSettings,
} from "./sanitize-store";
import type { Category, Item, ReminderPreset } from "./types";

describe("sanitizeCategories", () => {
  it("repairs categories missing a name", () => {
    const broken = [
      { id: "1", name: undefined, color: "#000" },
      { id: "2", name: "  Math  ", color: "#111" },
    ] as unknown as Category[];
    const next = sanitizeCategories(broken);
    expect(next[0].name).toBe("Uncategorized");
    expect(next[1].name).toBe("Math");
  });

  it("repairs a missing or malformed colour", () => {
    const broken = [
      { id: "1", name: "Math", color: undefined },
      { id: "2", name: "Work", color: "not-a-colour" },
      { id: "3", name: "Personal", color: "#3DBE8B" },
    ] as unknown as Category[];
    const next = sanitizeCategories(broken);
    expect(next[0].color).toBe("#8E8E93");
    expect(next[1].color).toBe("#8E8E93");
    expect(next[2].color).toBe("#3DBE8B");
  });

  it("returns the same array when nothing needs repairing", () => {
    const clean: Category[] = [{ id: "1", name: "Math", color: "#000" }];
    expect(sanitizeCategories(clean)).toBe(clean);
  });
});

describe("sanitizeReminderPresets", () => {
  it("repairs a preset missing a label or offset", () => {
    const broken = [
      { id: "rp-1", label: undefined, offsetMinutes: undefined },
      { id: "rp-2", label: "  1 hour before  ", offsetMinutes: 60 },
    ] as unknown as ReminderPreset[];
    const next = sanitizeReminderPresets(broken);
    expect(next[0].label).toBe("Reminder");
    expect(next[0].offsetMinutes).toBe(15);
    expect(next[1].label).toBe("1 hour before");
  });

  it("returns the same array when nothing needs repairing", () => {
    const clean: ReminderPreset[] = [{ id: "rp-1", label: "15 minutes before", offsetMinutes: 15 }];
    expect(sanitizeReminderPresets(clean)).toBe(clean);
  });
});

describe("sanitizeSettings", () => {
  it("falls back to today for an invalid landing view", () => {
    expect(sanitizeSettings({ landingView: "home" } as never).landingView).toBe("today");
    expect(sanitizeSettings(undefined).landingView).toBe("today");
  });

  it("keeps a valid custom theme and drops a broken one", () => {
    const customTheme = { background: "#f3f0ff", surface: "#ffffff", accent: "#7c5cf0" };
    const kept = sanitizeSettings({
      landingView: "today",
      customTheme,
    } as never);
    expect(kept.customTheme).toEqual(customTheme);

    const dropped = sanitizeSettings({
      landingView: "today",
      customTheme: { background: "nope", surface: "#fff", accent: "#000" },
    } as never);
    expect(dropped.customTheme).toBeUndefined();
  });
});

describe("buildImportPlan", () => {
  it("skips categories with missing names instead of throwing", () => {
    const existing = [
      { id: "c1", name: undefined, color: "#000" },
      { id: "c2", name: "ENGL 101", color: "#111" },
    ] as unknown as Category[];
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
      existing,
      "source-1"
    );
    expect(plan.newCategories).toHaveLength(0);
    expect(plan.drafts[0].categoryId).toBe("c2");
  });
});

describe("sanitizeItems", () => {
  const ok = (over: Partial<Item> = {}): Item => ({
    id: "i1",
    categoryId: "c1",
    type: "event",
    title: "Lecture",
    at: "2026-09-09T12:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  });

  it("returns the same array when nothing needs repair", () => {
    const items = [ok()];
    expect(sanitizeItems(items)).toBe(items);
  });

  it("drops items whose `at` can't be parsed", () => {
    // date-fns `format` throws on an invalid date, so one of these in the store
    // white-screens every view that renders it — and survives a reload.
    const out = sanitizeItems([ok(), ok({ id: "bad", at: "nonsense" })]);
    expect(out.map((i) => i.id)).toEqual(["i1"]);
  });

  it("drops non-objects and items with no id", () => {
    const out = sanitizeItems([
      null,
      42,
      "x",
      [],
      ok({ id: "" }),
      ok(),
    ] as unknown as Item[]);
    expect(out.map((i) => i.id)).toEqual(["i1"]);
  });

  it("collapses duplicate ids", () => {
    const out = sanitizeItems([ok(), ok({ title: "Copy" })]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Lecture");
  });

  it("normalizes out-of-range types, statuses and dates", () => {
    const out = sanitizeItems([
      ok({
        type: "banana" as Item["type"],
        status: "maybe" as Item["status"],
        endAt: "nope",
        createdAt: "nope",
        title: 7 as unknown as string,
      }),
    ]);
    expect(out[0].type).toBe("task");
    expect(out[0].status).toBeUndefined();
    expect(out[0].endAt).toBeUndefined();
    expect(out[0].createdAt).toBe("2026-09-09T12:00:00.000Z");
    expect(out[0].title).toBe("");
  });

  it("keeps a non-array reminders field from reaching the scheduler", () => {
    const out = sanitizeItems([ok({ reminders: "oops" as unknown as Item["reminders"] })]);
    expect(out[0].reminders).toBeUndefined();
  });

  it("handles a missing or non-array list", () => {
    expect(sanitizeItems(undefined)).toEqual([]);
    expect(sanitizeItems("nope" as unknown as Item[])).toEqual([]);
  });
});
