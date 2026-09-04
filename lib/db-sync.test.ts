import { describe, expect, it } from "vitest";
import {
  FALLBACK_CATEGORY_COLOR,
  rowToCategory,
  rowToPreset,
  toCategoryRow,
  toItemRow,
  toPresetRow,
  toSettingsRow,
} from "./db-sync";
import type { Category, Item, ReminderPreset, UserSettings } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";

function item(patch: Partial<Item> = {}): Item {
  return {
    id: "i1",
    categoryId: "c1",
    type: "assignment",
    title: "Essay",
    at: "2026-09-02T23:59:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...patch,
  };
}

describe("toCategoryRow", () => {
  it("never emits a null name or colour", () => {
    // `categories.name`/`.color` are NOT NULL; an undefined value is dropped by
    // JSON.stringify on the way out and lands as NULL, which used to fail the
    // whole write queue with "null value in column \"color\"".
    const broken = { id: "c1" } as unknown as Category;
    const row = toCategoryRow(broken, USER);
    expect(row.name).toBe("Uncategorized");
    expect(row.color).toBe(FALLBACK_CATEGORY_COLOR);
  });

  it("repairs a blank name and a non-colour string", () => {
    const row = toCategoryRow({ id: "c1", name: "   ", color: "rgb(0,0,0)" }, USER);
    expect(row.name).toBe("Uncategorized");
    expect(row.color).toBe(FALLBACK_CATEGORY_COLOR);
  });

  it("keeps good values, trimming the name", () => {
    const row = toCategoryRow({ id: "c1", name: " ENGL 101 ", color: "#007AFF" }, USER);
    expect(row.name).toBe("ENGL 101");
    expect(row.color).toBe("#007AFF");
  });
});

describe("rowToCategory", () => {
  it("substitutes a fallback for a null colour rather than propagating it", () => {
    const cat = rowToCategory({ id: "c1", name: null, color: null });
    expect(cat.name).toBe("Uncategorized");
    expect(cat.color).toBe(FALLBACK_CATEGORY_COLOR);
  });
});

describe("toItemRow", () => {
  it("emits an identical key set whatever the item carries", () => {
    // PostgREST rejects a bulk upsert whose rows have differing keys, so one
    // item with a link used to poison every item batched with it.
    const bare = Object.keys(toItemRow(item(), USER)).sort();
    const full = Object.keys(
      toItemRow(
        item({
          url: "https://example.com",
          repeat: { freq: "weekly" },
          repeatId: "r1",
          completedAt: "2026-09-02T00:00:00.000Z",
          endAt: "2026-09-03T00:00:00.000Z",
        }),
        USER
      )
    ).sort();
    expect(bare).toEqual(full);
  });

  it("nulls a cleared link or repeat rule so the cloud copy clears too", () => {
    const row = toItemRow(item(), USER);
    expect(row.url).toBeNull();
    expect(row.repeat).toBeNull();
    expect(row.repeat_id).toBeNull();
  });

  it("rejects an unparseable timestamp instead of writing it", () => {
    expect(() => toItemRow(item({ at: "not a date" }), USER)).toThrow(RangeError);
  });
});

describe("toPresetRow", () => {
  it("never emits a null label or offset", () => {
    // `reminder_presets.label`/`.offset_minutes` are NOT NULL with no default;
    // an undefined value is dropped by JSON.stringify on the way out and lands
    // as a missing column, which fails the insert with "null value in column
    // \"label\"" and, since presets push before items, stalls the whole queue.
    const broken = { id: "rp-1" } as unknown as ReminderPreset;
    const row = toPresetRow(broken, USER);
    expect(row.label).toBe("Reminder");
    expect(row.offset_minutes).toBe(15);
  });

  it("keeps good values, trimming the label", () => {
    const row = toPresetRow({ id: "rp-1", label: " 1 hour before ", offsetMinutes: 60 }, USER);
    expect(row.label).toBe("1 hour before");
    expect(row.offset_minutes).toBe(60);
  });
});

describe("rowToPreset", () => {
  it("substitutes a fallback for a null label or offset rather than propagating it", () => {
    const preset = rowToPreset({ id: "rp-1", label: null, offset_minutes: null });
    expect(preset.label).toBe("Reminder");
    expect(preset.offsetMinutes).toBe(15);
  });
});

describe("toSettingsRow", () => {
  it("carries the mobile day-details preference", () => {
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
      mobileDayDetails: "inline",
    };
    expect(toSettingsRow(settings, USER).mobile_day_details).toBe("inline");
  });
});
