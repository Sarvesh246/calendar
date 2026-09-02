/**
 * Deletion tombstones.
 *
 * A union merge alone can't tell "this row was deleted on my phone" from "this
 * row hasn't reached my phone yet" — so without a record of the delete, every
 * reconcile pass resurrects whatever the other device removed. Each delete
 * writes a tombstone locally (persisted) and to the cloud `deletions` table, and
 * the merge drops any row whose tombstone is at least as new as the row itself.
 */

export type EntityKind = "item" | "category" | "import_source" | "reminder_preset";

/** `${kind}:${id}` → ISO delete time. */
export type TombstoneMap = Record<string, string>;

export function tombKey(kind: EntityKind, id: string): string {
  return `${kind}:${id}`;
}

export function time(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Union two tombstone maps, keeping the later delete time for each key. */
export function mergeTombstones(a: TombstoneMap, b: TombstoneMap): TombstoneMap {
  const out: TombstoneMap = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!out[k] || time(v) > time(out[k])) out[k] = v;
  }
  return out;
}

/** Tombstones are only needed until every device has reconciled past them. */
export const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export function pruneTombstones(t: TombstoneMap, now = Date.now()): TombstoneMap {
  const out: TombstoneMap = {};
  for (const [k, v] of Object.entries(t)) {
    if (now - time(v) < TOMBSTONE_TTL_MS) out[k] = v;
  }
  return out;
}

/**
 * True when `id` was deleted at or after the row's own last edit.
 *
 * The `>=` matters: a row and its tombstone can carry the same timestamp when a
 * delete follows an edit inside the same millisecond, and a delete that loses
 * that tie would resurrect the row. Re-creating or editing a row *after*
 * deleting it does move `updatedAt` past the tombstone, which correctly revives
 * it — that's the undo path.
 */
export function isDeleted(
  tombstones: TombstoneMap,
  kind: EntityKind,
  row: { id: string; updatedAt?: string; createdAt?: string }
): boolean {
  const at = tombstones[tombKey(kind, row.id)];
  if (!at) return false;
  return time(at) >= time(row.updatedAt ?? row.createdAt);
}
