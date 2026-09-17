import { nanoid } from "./nanoid";
import type { Category, Item, ReminderPreset } from "./types";

/**
 * A fresh pair of ids every call, not fixed constants — `categories.id` is
 * a single global primary key in Supabase (not scoped per user_id like
 * reminder_presets is), so two accounts that both got the same hardcoded
 * default id used to race to "own" that row: whichever account synced
 * first claimed it, and every other account's upsert of its own untouched
 * default category then hit row-level security ("new row violates row
 * level security (USING expression)") trying to update a row it didn't own.
 */
export function createDefaultCategories(): Category[] {
  return [
    { id: nanoid(), name: "Personal", color: "#3DBE8B" },
    { id: nanoid(), name: "Work", color: "#007AFF" },
  ];
}

export const defaultReminderPresets: ReminderPreset[] = [
  { id: "rp-15m", label: "15 minutes before", offsetMinutes: 15 },
  { id: "rp-1h", label: "1 hour before", offsetMinutes: 60 },
  { id: "rp-night", label: "Night before (9pm)", offsetMinutes: 12 * 60 },
  { id: "rp-week", label: "1 week before", offsetMinutes: 7 * 24 * 60 },
];

// No seeded items — the app starts empty so you can add your own.
export const defaultItems: Item[] = [];
