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
 *  4. An item's status is merged on its own clock (`statusAt`), so a feed
 *     re-import on one device can't roll back what you ticked off on another.
 *  5. Two categories with the same name are collapsed into one, and items
 *     pointing at the loser are repointed.
 *
 * `tombstones` should already be the union of the local and cloud tombstones.
 */
export function mergeCalendars(
  local: CalendarSnapshot,
  cloud: CalendarSnapshot,
  tombstones: TombstoneMap = {}
): CalendarSnapshot {
  const { categories, remap } = dedupeCategories(
    reconcile("category", local.categories, cloud.categories, tombstones)
  );
  return {
    categories,
    reminderPresets: reconcile(
      "reminder_preset",
      local.reminderPresets,
      cloud.reminderPresets,
      tombstones
    ),
    importSources: dedupeByUrl(
      reconcile("import_source", local.importSources, cloud.importSources, tombstones)
    ),
    items: repointCategories(mergeItems(local.items, cloud.items, tombstones), remap),
    settings: pickSettings(local.settings, cloud.settings),
  };
}

function categoryKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Collapse categories that are the same class under two ids.
 *
 * A calendar feed resolves an event's course to a category *by name*, but the
 * merge unions categories *by id* — so each device that imported the feed
 * before syncing minted its own "ENGR-102…" and every one of them survived,
 * which is why the sidebar grew a new copy on each sync. Keep the oldest id
 * (the one other devices most likely already reference) and report the mapping
 * so items can be repointed.
 */
export function dedupeCategories(categories: Category[]): {
  categories: Category[];
  remap: Map<string, string>;
} {
  const winners = new Map<string, Category>();
  const remap = new Map<string, string>();
  for (const c of categories) {
    const key = categoryKey(c.name);
    // A blank name can't identify anything — leave those alone rather than
    // fusing unrelated rows together.
    if (!key) {
      winners.set(`id:${c.id}`, c);
      continue;
    }
    const held = winners.get(key);
    if (!held) {
      winners.set(key, c);
      continue;
    }
    // Prefer the one that has been around longest; ties break on id so every
    // device independently reaches the same answer.
    const keep = pickCategory(held, c);
    const drop = keep === held ? c : held;
    winners.set(key, keep);
    remap.set(drop.id, keep.id);
  }
  // A dropped category may itself have been a target earlier in the loop.
  for (const [from, to] of remap) {
    let dest = to;
    for (let i = 0; i < 8 && remap.has(dest); i += 1) dest = remap.get(dest)!;
    remap.set(from, dest);
  }
  return { categories: [...winners.values()], remap };
}

function pickCategory(a: Category, b: Category): Category {
  const at = time(a.updatedAt);
  const bt = time(b.updatedAt);
  if (at !== bt) return at < bt ? a : b; // older wins — it's the one already referenced
  return a.id <= b.id ? a : b;
}

function repointCategories(items: Item[], remap: Map<string, string>): Item[] {
  if (remap.size === 0) return items;
  return items.map((i) => {
    const to = remap.get(i.categoryId);
    return to ? { ...i, categoryId: to } : i;
  });
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

/** Content fields go to the newer edit; status is decided separately below. */
function pickContent(local: Item, cloud: Item): Item {
  const lt = time(local.updatedAt ?? local.createdAt);
  const ct = time(cloud.updatedAt ?? cloud.createdAt);
  if (lt !== ct) return lt > ct ? local : cloud;
  return local;
}

/**
 * Which side's status to keep.
 *
 * Deliberately not decided by `updatedAt`: a feed re-sync rewrites an item's
 * description or category and moves `updatedAt`, and that used to drag the
 * importing device's stale "todo" along with it, undoing a tick made on another
 * device. `statusAt` moves only when the status itself changes.
 */
function pickStatusFrom(local: Item, cloud: Item): Item {
  const ls = time(local.statusAt ?? local.completedAt);
  const cs = time(cloud.statusAt ?? cloud.completedAt);
  if (ls !== cs) return ls > cs ? local : cloud;

  // Neither side is stamped (or both at the same instant) — fall back to the
  // furthest-along status, since losing "done" is the worse outcome.
  const rank = (s: Item["status"]) => (s === "done" ? 2 : s === "doing" ? 1 : 0);
  const lr = rank(local.status);
  const cr = rank(cloud.status);
  if (lr !== cr) return lr > cr ? local : cloud;
  return local;
}

function pickItem(local: Item, cloud: Item): Item {
  const base = pickContent(local, cloud);
  const statusSide = pickStatusFrom(local, cloud);
  if (statusSide.status === base.status && statusSide.completedAt === base.completedAt) {
    return base;
  }
  const next: Item = { ...base, status: statusSide.status };
  if (statusSide.completedAt) next.completedAt = statusSide.completedAt;
  else delete next.completedAt;
  if (statusSide.statusAt) next.statusAt = statusSide.statusAt;
  else delete next.statusAt;
  return next;
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
