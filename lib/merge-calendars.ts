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
  const { categories: deduped, remap } = dedupeCategories(
    reconcile("category", local.categories, cloud.categories, tombstones)
  );
  const sources = dedupeByUrl(
    reconcile("import_source", local.importSources, cloud.importSources, tombstones)
  );
  // A feed row that loses the dedupe takes its items' `sourceId` with it —
  // otherwise every item that pointed at it is orphaned, and the next re-sync
  // can no longer tell those came from this feed, so it imports a second copy.
  const categories = repointSources(deduped, sources.remap);
  const items = collapseBySourceUid(
    repointSources(
      repointCategories(mergeItems(local.items, cloud.items, tombstones), remap),
      sources.remap
    ),
    new Set(local.items.map((i) => i.id))
  ).items;
  return {
    categories,
    reminderPresets: reconcile(
      "reminder_preset",
      local.reminderPresets,
      cloud.reminderPresets,
      tombstones
    ),
    importSources: sources.sources,
    items,
    settings: pickSettings(local.settings, cloud.settings),
  };
}

/** Follow a remap's chains so every entry points at a final survivor. */
function resolveChains(remap: Map<string, string>) {
  for (const [from, to] of remap) {
    let dest = to;
    for (let i = 0; i < 8 && remap.has(dest); i += 1) dest = remap.get(dest) as string;
    remap.set(from, dest);
  }
}

function repointSources<T extends { sourceId?: string }>(
  rows: T[],
  remap: Map<string, string>
): T[] {
  if (remap.size === 0) return rows;
  return rows.map((r) => {
    const to = r.sourceId ? remap.get(r.sourceId) : undefined;
    return to ? { ...r, sourceId: to } : r;
  });
}

/**
 * Which of two rows describing the same thing keeps its id.
 *
 * Deliberately independent of which device is asking. "Keep the local one" is
 * not: two devices reconciling the same duplicate pair at the same moment each
 * keep their own id and tombstone the other's, and the row vanishes from both.
 * Oldest wins (the original import — the id other devices most likely already
 * reference), then lowest id, so every device reaches the same answer.
 */
function pickSurvivor<T extends Stamped>(a: T, b: T): T {
  const at = time(a.createdAt);
  const bt = time(b.createdAt);
  if (at !== bt) return at < bt ? a : b;
  return a.id <= b.id ? a : b;
}

/**
 * Collapse rows that are the same feed event under different ids.
 *
 * A Canvas event has one UID but gets a fresh local id on every device that
 * imports it, so two devices that subscribed before they had ever synced push
 * two rows for one assignment. The old code only caught the case where the
 * local row was missing from the cloud — once both copies had been pushed,
 * every later reconcile saw two cloud rows and kept them both. On screen that
 * is the assignment listed twice, and since only one copy carries the tick, the
 * other sits there incomplete and overdue.
 *
 * Status is folded across the whole group, so the surviving row keeps the
 * furthest-along progress whichever copy it was recorded on.
 *
 * Rows are grouped per feed, not by UID alone: two unrelated calendars can
 * legitimately publish the same UID, and fusing two genuinely different events
 * loses one of them. The two devices' feed rows have already been collapsed and
 * repointed by then, so both copies of a shared subscription agree on it.
 */
export function collapseBySourceUid(
  items: Item[],
  /** Ids of the local copies. Used only to break an exact `updatedAt` tie —
   *  the local side is the only one that can hold an edit the cloud has not
   *  seen yet. The surviving *id* never depends on this. */
  localIds: ReadonlySet<string> = new Set()
): { items: Item[]; dropped: string[] } {
  const groups = new Map<string, Item[]>();
  let duplicated = false;
  for (const i of items) {
    const key = feedKey(i);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push(i);
      duplicated = true;
    } else {
      groups.set(key, [i]);
    }
  }
  if (!duplicated) return { items, dropped: [] };

  const winners = new Map<string, Item>();
  const dropped: string[] = [];
  for (const [uid, group] of groups) {
    if (group.length === 1) {
      winners.set(uid, group[0]);
      continue;
    }
    // Sorted so the fold order — and every tie it breaks — is identical on
    // every device.
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const keep = sorted.reduce(pickSurvivor);
    let merged = keep;
    let mergedIsLocal = localIds.has(keep.id);
    for (const other of sorted) {
      if (other.id === keep.id) continue;
      dropped.push(other.id);
      const folded = foldDuplicate(merged, mergedIsLocal, other, localIds.has(other.id));
      merged = folded.item;
      mergedIsLocal = folded.isLocal;
    }
    winners.set(uid, { ...merged, id: keep.id });
  }

  const emitted = new Set<string>();
  const out: Item[] = [];
  for (const i of items) {
    const key = feedKey(i);
    if (!key) {
      out.push(i);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);
    out.push(winners.get(key) as Item);
  }
  return { items: out, dropped };
}

/** Identity of the feed event a row came from, or null when it isn't imported. */
function feedKey(i: Item): string | null {
  return i.sourceUid ? `${i.sourceId ?? ""}::${i.sourceUid}` : null;
}

/** Fold one duplicate into another: newest content wins, status is merged on
 *  its own clock, and an exact timestamp tie goes to the local copy. */
function foldDuplicate(
  a: Item,
  aIsLocal: boolean,
  b: Item,
  bIsLocal: boolean
): { item: Item; isLocal: boolean } {
  const at = time(a.updatedAt ?? a.createdAt);
  const bt = time(b.updatedAt ?? b.createdAt);
  const takeB = bt > at || (bt === at && bIsLocal && !aIsLocal);
  const base = takeB ? b : a;
  return {
    item: withStatusFrom(base, pickStatusFrom(a, b)),
    isLocal: takeB ? bIsLocal : aIsLocal,
  };
}

/** The one way a category name is matched, everywhere. `buildImportPlan` used a
 *  slightly looser key (no internal-whitespace collapsing), so a course whose
 *  name came through with a double space was minted fresh on every sync and
 *  collapsed again by the next merge — a duplicate, a tombstone and a write
 *  every time round. */
export function categoryKey(name: string): string {
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
  resolveChains(remap);
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

/**
 * Two devices that subscribed to the same feed independently produce two source
 * rows with different ids — collapse them so the feed isn't listed twice.
 *
 * The survivor's id is chosen device-independently and reported back, because
 * items and auto-created categories point at it: dropping a row without
 * repointing them strands them on a source that no longer exists.
 */
function dedupeByUrl(sources: ImportSource[]): {
  sources: ImportSource[];
  remap: Map<string, string>;
} {
  const byUrl = new Map<string, ImportSource>();
  const remap = new Map<string, string>();
  for (const s of sources) {
    const held = byUrl.get(s.url);
    if (!held) {
      byUrl.set(s.url, s);
      continue;
    }
    const keep = pickSurvivor(held, s);
    const drop = keep === held ? s : held;
    // The survivor's identity, but the freshest sync state.
    byUrl.set(s.url, { ...newer(held, s), id: keep.id, addedAt: keep.addedAt });
    remap.set(drop.id, keep.id);
  }
  resolveChains(remap);
  return { sources: [...byUrl.values()], remap };
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

/** `base`'s content, carrying `statusSide`'s progress. */
function withStatusFrom(base: Item, statusSide: Item): Item {
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

function pickItem(local: Item, cloud: Item): Item {
  return withStatusFrom(pickContent(local, cloud), pickStatusFrom(local, cloud));
}

/** Union by id. Rows that share a `sourceUid` under different ids are collapsed
 *  afterwards by `collapseBySourceUid`, which does it device-independently. */
function mergeItems(local: Item[], cloud: Item[], tombstones: TombstoneMap): Item[] {
  const byId = new Map(cloud.map((i) => [i.id, i]));
  for (const item of local) {
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pickItem(item, existing) : item);
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
