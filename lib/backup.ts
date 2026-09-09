import { sanitizeCategories, sanitizeItems } from "./sanitize-store";
import type { Category, ImportSource, Item, ReminderPreset, UserSettings } from "./types";

export const BACKUP_VERSION = 1;

export interface DatebookBackup {
  version: number;
  exportedAt: string;
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  settings: UserSettings;
  importSources: ImportSource[];
}

export function serializeBackup(data: Omit<DatebookBackup, "version" | "exportedAt">): string {
  const payload: DatebookBackup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackup(raw: string): DatebookBackup {
  const data = JSON.parse(raw) as Partial<DatebookBackup>;
  if (!data || typeof data !== "object") throw new Error("Not a Datebook backup.");
  if (!Array.isArray(data.items) || !Array.isArray(data.categories)) {
    throw new Error("That file is missing calendar data.");
  }
  return {
    version: typeof data.version === "number" ? data.version : 1,
    exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : new Date().toISOString(),
    // A backup is an arbitrary file the user picked. Anything unrenderable in it
    // — an item with no parseable `at` above all — has to be caught here rather
    // than written straight into the store, where it crashes every view that
    // formats a date and survives a reload.
    categories: sanitizeCategories(
      data.categories.filter((c) => c && typeof c === "object" && typeof c.id === "string" && c.id)
    ),
    items: sanitizeItems(data.items),
    reminderPresets: Array.isArray(data.reminderPresets) ? data.reminderPresets : [],
    settings: data.settings as UserSettings,
    importSources: Array.isArray(data.importSources) ? data.importSources : [],
  };
}
