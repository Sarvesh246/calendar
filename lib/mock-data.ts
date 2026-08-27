import type { Category, Item, ReminderPreset } from "./types";

export const defaultCategories: Category[] = [
  { id: "cat-personal", name: "Personal", color: "#3DBE8B" },
  { id: "cat-work", name: "Work", color: "#7C6CFF" },
];

export const defaultReminderPresets: ReminderPreset[] = [
  { id: "rp-15m", label: "15 minutes before", offsetMinutes: 15 },
  { id: "rp-1h", label: "1 hour before", offsetMinutes: 60 },
  { id: "rp-night", label: "Night before (9pm)", offsetMinutes: 12 * 60 },
  { id: "rp-week", label: "1 week before", offsetMinutes: 7 * 24 * 60 },
];

// No seeded items — the app starts empty so you can add your own.
export const defaultItems: Item[] = [];
