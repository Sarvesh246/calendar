import type { Category, ImportSource, Item, ReminderPreset, UserSettings } from "./types";

export interface CalendarSnapshot {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  importSources: ImportSource[];
  settings: UserSettings;
}

/** Union two calendars. Local wins on id conflict; items also dedupe by sourceUid. */
export function mergeCalendars(local: CalendarSnapshot, cloud: CalendarSnapshot): CalendarSnapshot {
  const categories = unionById(cloud.categories, local.categories);
  const reminderPresets = local.reminderPresets.length
    ? unionById(cloud.reminderPresets, local.reminderPresets)
    : cloud.reminderPresets;
  const importSources = unionByKey(
    cloud.importSources,
    local.importSources,
    (s) => s.url
  );
  const items = mergeItems(local.items, cloud.items);
  return {
    categories,
    items,
    reminderPresets,
    importSources,
    settings: local.settings,
  };
}

function unionById<T extends { id: string }>(base: T[], overlay: T[]): T[] {
  const map = new Map(base.map((x) => [x.id, x]));
  for (const row of overlay) map.set(row.id, row);
  return [...map.values()];
}

function unionByKey<T>(base: T[], overlay: T[], key: (x: T) => string): T[] {
  const map = new Map(base.map((x) => [key(x), x]));
  for (const row of overlay) map.set(key(row), row);
  return [...map.values()];
}

function mergeItems(local: Item[], cloud: Item[]): Item[] {
  const byId = new Map(cloud.map((i) => [i.id, i]));
  const uidToId = new Map(
    cloud.filter((i) => i.sourceUid).map((i) => [i.sourceUid as string, i.id])
  );
  for (const item of local) {
    if (item.sourceUid && uidToId.has(item.sourceUid) && !byId.has(item.id)) {
      const cloudId = uidToId.get(item.sourceUid)!;
      byId.delete(cloudId);
    }
    byId.set(item.id, item);
    if (item.sourceUid) uidToId.set(item.sourceUid, item.id);
  }
  return [...byId.values()];
}
