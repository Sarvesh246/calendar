import { nanoid } from "./nanoid";
import { time } from "./tombstones";
import type { Item } from "./types";

/**
 * Cross-device edit notices.
 *
 * The originating device used to toast on the echo of its *own* write, because
 * a round-trip through Postgres + `rowToItem` is almost never JSON-identical
 * to the in-memory row (omitted vs explicit false, timestamp formatting).
 * Other devices never toasted, because they hadn't edited the row locally.
 *
 * A notice is therefore:
 *  - never the echo of a write this device just made
 *  - only when user-visible fields actually changed
 *  - "conflict" when this device was also editing the same row
 *  - "remote" when it wasn't (the other device's update landing here)
 *  - collapsed to one "bulk" card when a feed/import floods the channel
 */

export type SyncNoticeKind = "remote" | "conflict" | "bulk";

export type SyncNotice = {
  /** Stable while the card is on screen, so a replace doesn't remount it. */
  id: string;
  itemId: string;
  title: string;
  kind: SyncNoticeKind;
  /** Bumps when the same item is replaced, so the auto-dismiss timer restarts. */
  rev: number;
};

export type NoticeDraft = {
  itemId: string;
  title: string;
  kind: Exclude<SyncNoticeKind, "bulk">;
};

/** How long a local write is treated as "ours" for echo detection. */
export const LOCAL_WRITE_WINDOW_MS = 45_000;

/** Postgres can round a timestamptz by a millisecond or two on the way back. */
export const OWN_WRITE_SKEW_MS = 25;

export const MAX_STACKED_NOTICES = 3;
export const BULK_NOTICE_THRESHOLD = 4;
export const NOTICE_COALESCE_MS = 90;

const BULK_ITEM_ID = "__bulk__";

function stamp(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toISOString();
}

/**
 * User-visible identity of an item. Mapper noise (missing vs false `allDay`,
 * extra reminder fields, `updatedAt`) is stripped so an echo can't look like
 * a conflict.
 */
export function itemNoticeFingerprint(item: Item): string {
  const reminders = (item.reminders ?? [])
    .map((r) => r.offsetMinutes)
    .sort((a, b) => a - b);
  return JSON.stringify({
    title: item.title,
    at: stamp(item.at),
    endAt: stamp(item.endAt),
    allDay: Boolean(item.allDay),
    status: item.status ?? "todo",
    location: item.location ?? "",
    description: item.description ?? "",
    categoryId: item.categoryId ?? "",
    type: item.type,
    url: item.url ?? "",
    reminders,
  });
}

export function isOwnWriteEcho(
  remoteUpdatedAt: string | undefined,
  lastLocalUpdatedAt: string | undefined
): boolean {
  if (!remoteUpdatedAt || !lastLocalUpdatedAt) return false;
  return time(remoteUpdatedAt) <= time(lastLocalUpdatedAt) + OWN_WRITE_SKEW_MS;
}

export function decideRemoteItemNotice(input: {
  prev: Item;
  remote: Item;
  lastWrittenAt?: string;
  editedHereRecently: boolean;
}): NoticeDraft | null {
  if (itemNoticeFingerprint(input.prev) === itemNoticeFingerprint(input.remote)) {
    return null;
  }
  if (isOwnWriteEcho(input.remote.updatedAt, input.lastWrittenAt)) return null;
  // Not newer than what's already on screen — either an echo or a stale
  // broadcast. The caller keeps/applies based on timestamps separately.
  if (time(input.remote.updatedAt) <= time(input.prev.updatedAt ?? input.prev.createdAt)) {
    return null;
  }
  return {
    itemId: input.remote.id,
    title: input.remote.title?.trim() || input.prev.title?.trim() || "an item",
    kind: input.editedHereRecently ? "conflict" : "remote",
  };
}

function upsertOne(
  current: SyncNotice[],
  draft: { itemId: string; title: string; kind: SyncNoticeKind },
  makeId: () => string
): SyncNotice[] {
  const idx = current.findIndex((n) => n.itemId === draft.itemId);
  if (idx >= 0) {
    const updated: SyncNotice = {
      ...current[idx],
      title: draft.title,
      kind: draft.kind,
      rev: current[idx].rev + 1,
    };
    return [updated, ...current.filter((_, i) => i !== idx)];
  }
  return [
    {
      id: makeId(),
      itemId: draft.itemId,
      title: draft.title,
      kind: draft.kind,
      rev: 0,
    },
    ...current,
  ];
}

/** Fold a burst of drafts into the on-screen stack: replace per item, cap
 *  height, collapse a flood into one card. */
export function mergeNoticeBatch(
  current: SyncNotice[],
  drafts: NoticeDraft[],
  makeId: () => string = nanoid
): SyncNotice[] {
  if (drafts.length === 0) return current;

  const byItem = new Map<string, NoticeDraft>();
  for (const d of drafts) byItem.set(d.itemId, d);
  const unique = [...byItem.values()];
  const remotes = unique.filter((d) => d.kind === "remote");
  const conflicts = unique.filter((d) => d.kind === "conflict");

  if (remotes.length >= BULK_NOTICE_THRESHOLD) {
    let next = current.filter((n) => n.kind === "conflict");
    for (const d of conflicts) next = upsertOne(next, d, makeId);
    next = upsertOne(
      next,
      { itemId: BULK_ITEM_ID, title: `${remotes.length} items`, kind: "bulk" },
      makeId
    );
    return next.slice(0, MAX_STACKED_NOTICES);
  }

  let next = current.filter((n) => n.kind !== "bulk");
  for (const d of unique) next = upsertOne(next, d, makeId);
  return next.slice(0, MAX_STACKED_NOTICES);
}

export function dismissSyncNotice(current: SyncNotice[], id: string): SyncNotice[] {
  return current.filter((n) => n.id !== id);
}
