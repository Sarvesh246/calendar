import { IMPORT_PALETTE } from "./calendar-import";
import { nanoid } from "./nanoid";
import { dedupeCategories } from "./merge-calendars";
import { sanitizeCategories } from "./sanitize-store";
import { snapshotFrom } from "./source-snapshot";
import {
  collapseCrossSourceDuplicates,
  defaultSyllabusDecision,
  isSyllabusSource,
  matchSyllabusItems,
  resolveSyllabusCourse,
  syllabusSourceUid,
  syllabusSourceUrl,
  type SyllabusDraft,
  type SyllabusRowDecision,
} from "./syllabus-match";
import { tombKey, type TombstoneMap } from "./tombstones";
import type { Category, ImportSource, Item } from "./types";

export {
  defaultSyllabusDecision,
  groupSyllabusMatches,
  isSyllabusSource,
  isSyllabusSourceUrl,
  isSyllabusSourceUid,
  summarizeSyllabusMatches,
  syllabusSourceUrl,
  type SyllabusDraft,
  type SyllabusMatch,
  type SyllabusRowDecision,
  type SyllabusVerdict,
} from "./syllabus-match";

export interface SyllabusImportRequest {
  drafts: SyllabusDraft[];
  timeZone: string;
  /** Settings row: every extracted row is filed on this class. */
  forceCategoryId?: string;
  courseName?: string;
  courseCode?: string;
  fileName?: string;
  /**
   * Parallel to `drafts`. When omitted: import "new", link confident matches,
   * skip "check these".
   */
  decisions?: SyllabusRowDecision[];
}

export interface SyllabusImportResult {
  added: number;
  matched: number;
  collapsed: number;
  categoryId: string;
  warning?: string;
}

export interface SyllabusSnapshot {
  items: Item[];
  categories: Category[];
  importSources: ImportSource[];
  deletions: TombstoneMap;
}

/**
 * Apply a reviewed syllabus extract. New rows get `sourceUid` `syl:{date}:{fp}`
 * and a `syllabus://` ImportSource. Matches keep title / url / status (and the
 * Canvas UID); empty descriptions may be filled from notes. Missed rows from a
 * previous import are not pruned.
 */
export function applySyllabusImportToSnapshot(
  snapshot: SyllabusSnapshot,
  request: SyllabusImportRequest,
  opts?: { now?: string; id?: () => string }
): { snapshot: SyllabusSnapshot; result: SyllabusImportResult } {
  const now = opts?.now ?? new Date().toISOString();
  const nextId = opts?.id ?? nanoid;
  const timeZone = request.timeZone;

  const deduped = dedupeCategories(sanitizeCategories(snapshot.categories));
  const remap = deduped.remap;
  let categories = deduped.categories;
  const items =
    remap.size === 0
      ? [...snapshot.items]
      : snapshot.items.map((i) => {
          const to = remap.get(i.categoryId);
          return to ? { ...i, categoryId: to } : i;
        });
  let deletions = snapshot.deletions;
  if (remap.size > 0) {
    deletions = stampTombstones(deletions, "category", [...remap.keys()], now);
  }

  const forceCategoryId = request.forceCategoryId
    ? (remap.get(request.forceCategoryId) ?? request.forceCategoryId)
    : undefined;
  const resolved = resolveSyllabusCourse({
    categories,
    courseName: request.courseName,
    courseCode: request.courseCode,
    forceCategoryId,
  });

  let categoryId: string;
  let warning: string | undefined;
  let pendingNew: { id: string; name: string; color: string } | undefined;
  if (resolved.status === "create") {
    pendingNew = {
      id: nextId(),
      name: resolved.name,
      color: IMPORT_PALETTE[categories.length % IMPORT_PALETTE.length],
    };
    categoryId = pendingNew.id;
  } else {
    categoryId = resolved.categoryId;
    warning = resolved.status === "forced" ? resolved.warning : undefined;
  }

  const categoryName =
    pendingNew?.name ?? categories.find((c) => c.id === categoryId)?.name ?? "Imported";
  const url = syllabusSourceUrl(categoryName);
  const existingSource = snapshot.importSources.find((s) => s.url === url);
  const syllabusSourceId = existingSource?.id ?? nextId();

  if (pendingNew) {
    categories = [
      ...categories,
      { ...pendingNew, sourceId: syllabusSourceId, updatedAt: now },
    ];
  }

  const matches = matchSyllabusItems(request.drafts, items, { timeZone, categoryId });
  const seenUid = new Set(
    items
      .filter((i) => i.sourceId === syllabusSourceId && i.sourceUid)
      .map((i) => i.sourceUid as string)
  );

  let added = 0;
  let matched = 0;
  const nextItems = items.map((i) => ({ ...i }));
  const byId = new Map(nextItems.map((i) => [i.id, i]));

  request.drafts.forEach((draft, index) => {
    const match = matches[index];
    const decision =
      request.decisions?.[index] ?? defaultSyllabusDecision(match?.verdict ?? "new");
    if (decision === "skip") return;

    const existing = match?.existing ? byId.get(match.existing.id) : undefined;
    // `import` on a confident match still links — never mint a twin of an existing row.
    const shouldLink =
      decision === "link" || (decision === "import" && match?.verdict === "matched" && existing);

    if (shouldLink && existing) {
      matched += 1;
      const patched = patchMatchedItem(existing, draft, now);
      if (patched !== existing) {
        const idx = nextItems.findIndex((i) => i.id === existing.id);
        if (idx !== -1) nextItems[idx] = patched;
        byId.set(existing.id, patched);
      }
      return;
    }

    if (decision !== "import") return;

    const uid = syllabusSourceUid(draft.title, draft.at, timeZone);
    if (seenUid.has(uid)) {
      matched += 1;
      return;
    }
    seenUid.add(uid);
    const created = draftToItem(draft, {
      id: nextId(),
      categoryId,
      sourceId: syllabusSourceId,
      sourceUid: uid,
      now,
    });
    nextItems.push(created);
    byId.set(created.id, created);
    added += 1;
  });

  const sourceName = request.fileName?.trim() || categoryName;
  const source: ImportSource = {
    id: syllabusSourceId,
    url,
    name: sourceName,
    addedAt: existingSource?.addedAt ?? now,
    lastSyncedAt: now,
    itemCount: 0,
    updatedAt: now,
  };
  const sources = existingSource
    ? snapshot.importSources.map((s) => (s.id === syllabusSourceId ? source : s))
    : [...snapshot.importSources, source];

  const collapsed = collapseCrossSourceDuplicates(nextItems, sources, timeZone, now);
  deletions = stampTombstones(deletions, "item", collapsed.dropped, now);
  const importSources = recountSyllabusItemCounts(sources, collapsed.items, now);

  return {
    snapshot: {
      items: collapsed.items,
      categories,
      importSources,
      deletions,
    },
    result: {
      added,
      matched,
      collapsed: collapsed.dropped.length,
      categoryId,
      ...(warning ? { warning } : {}),
    },
  };
}

/** Recompute `itemCount` on syllabus sources after a collapse. */
export function recountSyllabusItemCounts(
  sources: ImportSource[],
  items: Item[],
  now: string
): ImportSource[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.sourceId) continue;
    counts.set(item.sourceId, (counts.get(item.sourceId) ?? 0) + 1);
  }
  let changed = false;
  const next = sources.map((s) => {
    if (!isSyllabusSource(s)) return s;
    const itemCount = counts.get(s.id) ?? 0;
    if (itemCount === s.itemCount) return s;
    changed = true;
    return { ...s, itemCount, updatedAt: now };
  });
  return changed ? next : sources;
}

function patchMatchedItem(item: Item, draft: SyllabusDraft, now: string): Item {
  // Leave title, url, status, and any Canvas sourceId/sourceUid alone.
  if (item.description?.trim() || !draft.notes?.trim()) return item;
  return { ...item, description: draft.notes.trim(), updatedAt: now };
}

function draftToItem(
  draft: SyllabusDraft,
  ids: { id: string; categoryId: string; sourceId: string; sourceUid: string; now: string }
): Item {
  const item: Item = {
    id: ids.id,
    categoryId: ids.categoryId,
    type: draft.type,
    title: draft.title,
    at: draft.at,
    createdAt: ids.now,
    updatedAt: ids.now,
    sourceId: ids.sourceId,
    sourceUid: ids.sourceUid,
    ...(draft.endAt ? { endAt: draft.endAt } : {}),
    ...(draft.allDay ? { allDay: true } : {}),
    ...(draft.notes?.trim() ? { description: draft.notes.trim() } : {}),
    ...(draft.type !== "event" ? { status: "todo" as const } : {}),
  };
  item.sourceSnapshot = snapshotFrom(item);
  return item;
}

function stampTombstones(
  current: TombstoneMap,
  kind: "item" | "category",
  ids: string[],
  at: string
): TombstoneMap {
  if (ids.length === 0) return current;
  const next = { ...current };
  for (const id of ids) next[tombKey(kind, id)] = at;
  return next;
}
