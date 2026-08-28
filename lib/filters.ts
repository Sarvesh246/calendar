import type { Item } from "./types";

export function applyCategoryFilter(items: Item[], categoryFilter: string[] | null) {
  if (!categoryFilter || categoryFilter.length === 0) return items;
  return items.filter((i) => !i.categoryId || categoryFilter.includes(i.categoryId));
}

export function applyItemFilters(
  items: Item[],
  opts: { categoryFilter: string[] | null; hideCompleted?: boolean }
) {
  let next = applyCategoryFilter(items, opts.categoryFilter);
  if (opts.hideCompleted) next = next.filter((i) => i.type === "event" || i.status !== "done");
  return next;
}
