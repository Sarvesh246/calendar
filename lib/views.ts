import { addDays, startOfDay, startOfWeek } from "date-fns";
import { isOverdueAt } from "./date-utils";
import type { Item, ItemStatus, ItemType } from "./types";

/**
 * Saved views: a named combination of the filters people reach for together —
 * "what's in progress", "this week's assignments", a group of classes. The
 * class part rides on the existing category filter; everything else narrows
 * the list on top of it.
 */
export type ViewRange = "any" | "overdue" | "today" | "this-week" | "next-7" | "next-30";

export interface ViewFilter {
  /** Work items only. Events have no status, so a status filter hides them. */
  statuses?: ItemStatus[];
  kinds?: ItemType[];
  range?: ViewRange;
}

export interface SavedView extends ViewFilter {
  id: string;
  name: string;
  /** Empty or missing means every class. */
  categoryIds?: string[];
  builtIn?: boolean;
}

export const VIEW_RANGES: { value: ViewRange; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "this-week", label: "This week" },
  { value: "next-7", label: "Next 7 days" },
  { value: "next-30", label: "Next 30 days" },
];

export const VIEW_STATUSES: { value: ItemStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
];

export const VIEW_KINDS: { value: ItemType; label: string }[] = [
  { value: "event", label: "Events" },
  { value: "assignment", label: "Assignments" },
  { value: "task", label: "Tasks" },
];

export const BUILT_IN_VIEWS: SavedView[] = [
  { id: "builtin-in-progress", name: "In progress", statuses: ["doing"], builtIn: true },
  {
    id: "builtin-week-assignments",
    name: "This week's assignments",
    kinds: ["assignment"],
    range: "this-week",
    builtIn: true,
  },
  {
    id: "builtin-open-work",
    name: "Open work",
    kinds: ["assignment", "task"],
    statuses: ["todo", "doing"],
    builtIn: true,
  },
];

export function isViewFilterEmpty(filter: ViewFilter | null | undefined): boolean {
  if (!filter) return true;
  return !filter.statuses?.length && !filter.kinds?.length && (!filter.range || filter.range === "any");
}

function rangeWindow(range: ViewRange, now: Date, weekStartsOn: 0 | 1): [Date, Date] | null {
  const today = startOfDay(now);
  switch (range) {
    case "today":
      return [today, addDays(today, 1)];
    case "this-week": {
      const start = startOfWeek(now, { weekStartsOn });
      return [start, addDays(start, 7)];
    }
    case "next-7":
      return [today, addDays(today, 7)];
    case "next-30":
      return [today, addDays(today, 30)];
    default:
      return null;
  }
}

export function itemMatchesView(
  item: Item,
  filter: ViewFilter,
  now: Date,
  weekStartsOn: 0 | 1 = 0
): boolean {
  if (filter.kinds?.length && !filter.kinds.includes(item.type)) return false;
  if (filter.statuses?.length) {
    if (item.type === "event") {
      if (!filter.kinds?.includes("event")) return false;
    } else if (!filter.statuses.includes(item.status ?? "todo")) {
      return false;
    }
  }
  const range = filter.range ?? "any";
  if (range === "any") return true;
  if (range === "overdue") return isOverdueAt(item, now);
  const window = rangeWindow(range, now, weekStartsOn);
  if (!window) return true;
  const start = new Date(item.at).getTime();
  if (Number.isNaN(start)) return false;
  const endRaw = item.endAt ? new Date(item.endAt).getTime() : start;
  const end = Number.isNaN(endRaw) ? start : Math.max(start, endRaw);
  return start < window[1].getTime() && end >= window[0].getTime();
}

export function applyViewFilter(
  items: Item[],
  filter: ViewFilter | null | undefined,
  now: Date,
  weekStartsOn: 0 | 1 = 0
): Item[] {
  if (isViewFilterEmpty(filter)) return items;
  return items.filter((item) => itemMatchesView(item, filter!, now, weekStartsOn));
}

/** "In progress · This week · 2 classes" — the line under a view's name. */
export function viewSummary(view: SavedView): string {
  const parts: string[] = [];
  if (view.statuses?.length) {
    parts.push(
      view.statuses
        .map((s) => VIEW_STATUSES.find((o) => o.value === s)?.label ?? s)
        .join(", ")
    );
  }
  if (view.kinds?.length) {
    parts.push(view.kinds.map((k) => VIEW_KINDS.find((o) => o.value === k)?.label ?? k).join(", "));
  }
  if (view.range && view.range !== "any") {
    parts.push(VIEW_RANGES.find((r) => r.value === view.range)?.label ?? view.range);
  }
  const classes = view.categoryIds?.length ?? 0;
  if (classes) parts.push(`${classes} class${classes === 1 ? "" : "es"}`);
  return parts.join(" · ") || "Everything";
}

const STATUS_SET = new Set<ItemStatus>(["todo", "doing", "done"]);
const KIND_SET = new Set<ItemType>(["event", "assignment", "task"]);
const RANGE_SET = new Set<ViewRange>(VIEW_RANGES.map((r) => r.value));
const MAX_SAVED_VIEWS = 24;

/** Views come back out of localStorage; anything malformed is dropped, not trusted. */
export function sanitizeSavedViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedView[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || seen.has(r.id)) continue;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) : "";
    if (!name) continue;
    seen.add(r.id);
    const statuses = Array.isArray(r.statuses)
      ? [...new Set(r.statuses.filter((s): s is ItemStatus => STATUS_SET.has(s as ItemStatus)))]
      : [];
    const kinds = Array.isArray(r.kinds)
      ? [...new Set(r.kinds.filter((k): k is ItemType => KIND_SET.has(k as ItemType)))]
      : [];
    const categoryIds = Array.isArray(r.categoryIds)
      ? [...new Set(r.categoryIds.filter((c): c is string => typeof c === "string" && c.length > 0))]
      : [];
    const range = RANGE_SET.has(r.range as ViewRange) ? (r.range as ViewRange) : "any";
    out.push({
      id: r.id,
      name,
      ...(statuses.length ? { statuses } : {}),
      ...(kinds.length ? { kinds } : {}),
      ...(categoryIds.length ? { categoryIds } : {}),
      ...(range !== "any" ? { range } : {}),
    });
    if (out.length >= MAX_SAVED_VIEWS) break;
  }
  return out;
}
