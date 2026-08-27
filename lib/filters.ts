import type { Item } from "./types";

export function applyCategoryFilter(items: Item[], categoryFilter: string[] | null) {
  if (!categoryFilter || categoryFilter.length === 0) return items;
  return items.filter((i) => categoryFilter.includes(i.categoryId));
}
