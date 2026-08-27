import type { Category, Item, ReminderPreset } from "./types";

// UUIDs (not "cat-personal" slugs) so these rows are valid in the Postgres
// `uuid` id column when synced to Supabase.
export const defaultCategories: Category[] = [
  { id: "f39a9750-ce6d-4039-a792-45680017f5f0", name: "Personal", color: "#3DBE8B" },
  { id: "1d3d851d-36c9-4570-896a-7b7de6875f27", name: "Work", color: "#7C6CFF" },
];

export const defaultReminderPresets: ReminderPreset[] = [
  { id: "rp-15m", label: "15 minutes before", offsetMinutes: 15 },
  { id: "rp-1h", label: "1 hour before", offsetMinutes: 60 },
  { id: "rp-night", label: "Night before (9pm)", offsetMinutes: 12 * 60 },
  { id: "rp-week", label: "1 week before", offsetMinutes: 7 * 24 * 60 },
];

// No seeded items — the app starts empty so you can add your own.
export const defaultItems: Item[] = [];
