import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./calendar-import";
import { sanitizeCategories, sanitizeReminderPresets, sanitizeSettings } from "./sanitize-store";
import type { Category, ReminderPreset } from "./types";

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
