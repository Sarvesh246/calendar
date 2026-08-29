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
    categories: data.categories,
    items: data.items,
    reminderPresets: Array.isArray(data.reminderPresets) ? data.reminderPresets : [],
    settings: data.settings as UserSettings,
    importSources: Array.isArray(data.importSources) ? data.importSources : [],
  };
}
