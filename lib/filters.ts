import type { Item } from "./types";
import { applyViewFilter, type ViewFilter } from "./views";

export function applyCategoryFilter(items: Item[], categoryFilter: string[] | null) {
  if (!categoryFilter || categoryFilter.length === 0) return items;
  return items.filter((i) => !i.categoryId || categoryFilter.includes(i.categoryId));
}

export function applyItemFilters(
  items: Item[],
  opts: {
    categoryFilter: string[] | null;
    hideCompleted?: boolean;
    viewFilter?: ViewFilter | null;
    now?: Date;
    weekStartsOn?: 0 | 1;
  }
) {
  let next = applyCategoryFilter(items, opts.categoryFilter);
  if (opts.hideCompleted) next = next.filter((i) => i.type === "event" || i.status !== "done");
  if (opts.viewFilter) {
    next = applyViewFilter(next, opts.viewFilter, opts.now ?? new Date(), opts.weekStartsOn ?? 0);
  }
  return next;
}
