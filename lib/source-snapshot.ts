import type { Item, SourceSnapshot } from "./types";

const KEYS: (keyof SourceSnapshot)[] = [
  "title",
  "description",
  "location",
  "url",
  "at",
  "endAt",
  "allDay",
  "type",
  "categoryId",
];

const REQUIRED: (keyof SourceSnapshot)[] = ["title", "at", "type", "categoryId"];

function norm(v: unknown) {
  if (v === undefined || v === false || v === "") return null;
  return v;
}

export function snapshotFrom(draft: Pick<Item, keyof SourceSnapshot>): SourceSnapshot {
  const snap: SourceSnapshot = {
    title: draft.title,
    at: draft.at,
    type: draft.type,
    categoryId: draft.categoryId,
  };
  if (draft.description) snap.description = draft.description;
  if (draft.location) snap.location = draft.location;
  if (draft.url) snap.url = draft.url;
  if (draft.endAt) snap.endAt = draft.endAt;
  if (draft.allDay) snap.allDay = true;
  return snap;
}

export function feedOwnsField<K extends keyof SourceSnapshot>(item: Item, key: K): boolean {
  const snap = item.sourceSnapshot;
  if (!snap) return true;
  return norm(item[key]) === norm(snap[key]);
}

/** Apply an incoming feed draft, keeping any field the user has changed since last sync. */
export function mergeImportedItem<T extends Omit<Item, "id" | "createdAt">>(
  item: Item,
  draft: T
): Item {
  const next: Item = {
    ...item,
    sourceId: draft.sourceId ?? item.sourceId,
    sourceUid: draft.sourceUid ?? item.sourceUid,
  };

  for (const key of KEYS) {
    if (!feedOwnsField(item, key)) continue;
    const incoming = draft[key];
    if (REQUIRED.includes(key)) {
      (next as unknown as Record<string, unknown>)[key] = incoming ?? item[key];
    } else if (incoming === undefined || incoming === false) {
      delete (next as unknown as Record<string, unknown>)[key];
    } else {
      (next as unknown as Record<string, unknown>)[key] = incoming;
    }
  }

  next.id = item.id;
  next.createdAt = item.createdAt;
  next.status = item.status ?? draft.status;
  next.reminders = item.reminders;
  next.completedAt = item.completedAt;
  next.sourceSnapshot = snapshotFrom(draft);
  return next;
}

export function importedFieldsChanged(before: Item, after: Item): boolean {
  return KEYS.some((k) => norm(before[k]) !== norm(after[k]));
}
