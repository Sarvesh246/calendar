import type { Category, ImportSource, Item, ReminderPreset, UserSettings } from "./types";
import { isDeleted, time, type EntityKind, type TombstoneMap } from "./tombstones";

export interface CalendarSnapshot {
  categories: Category[];
  items: Item[];
  reminderPresets: ReminderPreset[];
  importSources: ImportSource[];
  settings: UserSettings;
}

type Stamped = { id: string; updatedAt?: string; createdAt?: string };

/**
 * Reconcile two copies of the same calendar.
 *
 * Rules, in order:
 *  1. A row deleted on either device stays deleted (tombstones), unless it was
 *     edited *after* the delete.
 *  2. When both sides have a row, the one with the newer `updatedAt` wins — a
 *     genuine last-write-wins, rather than the old "whichever device happens to
 *     be reconciling" rule that silently discarded the other device's edits.
 *  3. Ties fall back to the further-along assignment status, then to local.
 *
 * `tombstones` should already be the union of the local and cloud tombstones.
 */
export function mergeCalendars(
  local: CalendarSnapshot,
  cloud: CalendarSnapshot,
  tombstones: TombstoneMap = {}
): CalendarSnapshot {
  return {
    categories: reconcile("category", local.categories, cloud.categories, tombstones),
    reminderPresets: reconcile(
      "reminder_preset",
      local.reminderPresets,
      cloud.reminderPresets,
      tombstones
    ),
    importSources: dedupeByUrl(
      reconcile("import_source", local.importSources, cloud.importSources, tombstones)
    ),
    items: mergeItems(local.items, cloud.items, tombstones),
    settings: pickSettings(local.settings, cloud.settings),
  };
}

/** Newer `updatedAt` wins; missing timestamps fall back to `createdAt`, then to local. */
function newer<T extends Stamped>(local: T, cloud: T): T {
  const lt = time(local.updatedAt ?? local.createdAt);
  const ct = time(cloud.updatedAt ?? cloud.createdAt);
  if (lt !== ct) return lt > ct ? local : cloud;
  return local;
}

function reconcile<T extends Stamped>(
  kind: EntityKind,
  local: T[],
  cloud: T[],
  tombstones: TombstoneMap
): T[] {
  const byId = new Map<string, T>();
  for (const row of cloud) byId.set(row.id, row);
  for (const row of local) {
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? newer(row, existing) : row);
  }
  return [...byId.values()].filter((row) => !isDeleted(tombstones, kind, row));
}

/** Two devices that subscribed to the same feed independently produce two source
 *  rows with different ids — collapse them so the feed isn't listed twice. */
function dedupeByUrl(sources: ImportSource[]): ImportSource[] {
  const byUrl = new Map<string, ImportSource>();
  for (const s of sources) {
    const existing = byUrl.get(s.url);
    byUrl.set(s.url, existing ? newer(s, existing) : s);
  }
  return [...byUrl.values()];
}

/** Prefer the row with the furthest-along assignment status; tie goes to local. */
function pickItem(local: Item, cloud: Item): Item {
  const lt = time(local.updatedAt ?? local.createdAt);
  const ct = time(cloud.updatedAt ?? cloud.createdAt);
  if (lt !== ct) return lt > ct ? local : cloud;

  // Same edit time (or neither is stamped — data written before this app
  // recorded edit times). Marking something done is the edit least safe to
  // lose, so let progress break the tie.
  const rank = (s: Item["status"]) => (s === "done" ? 2 : s === "doing" ? 1 : 0);
  const lr = rank(local.status);
  const cr = rank(cloud.status);
  if (lr !== cr) return lr > cr ? local : cloud;
  if (local.status === "done" && cloud.status === "done") {
    const lc = time(local.completedAt);
    const cc = time(cloud.completedAt);
    if (lc !== cc) return lc > cc ? local : cloud;
  }
  return local;
}

function mergeItems(local: Item[], cloud: Item[], tombstones: TombstoneMap): Item[] {
  const byId = new Map(cloud.map((i) => [i.id, i]));
  const uidToId = new Map(
    cloud.filter((i) => i.sourceUid).map((i) => [i.sourceUid as string, i.id])
  );
  for (const item of local) {
    // The same feed event imported separately on two devices has two ids but one
    // sourceUid — collapse onto the local id rather than showing it twice.
    if (item.sourceUid && uidToId.has(item.sourceUid) && !byId.has(item.id)) {
      const cloudId = uidToId.get(item.sourceUid)!;
      const twin = byId.get(cloudId);
      byId.delete(cloudId);
      // Don't lose the cloud twin's progress just because the ids differ.
      if (twin) {
        byId.set(item.id, { ...pickItem(item, { ...twin, id: item.id }), id: item.id });
        uidToId.set(item.sourceUid, item.id);
        continue;
      }
    }
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickItem(item, existing) : item);
    if (item.sourceUid) uidToId.set(item.sourceUid, item.id);
  }
  return [...byId.values()].filter((row) => !isDeleted(tombstones, "item", row));
}

/** Settings are one row, so they need the same last-write-wins treatment as items —
 *  the old code always kept the local copy, which reverted the other device's
 *  appearance and preference changes on every reconnect. */
function pickSettings(local: UserSettings, cloud: UserSettings | undefined): UserSettings {
  if (!cloud) return local;
  return time(cloud.updatedAt) > time(local.updatedAt) ? cloud : local;
}
