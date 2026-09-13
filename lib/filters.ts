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

export interface FilterBreakdown {
  visible: Item[];
  /** Everything in scope with every filter switched off. */
  total: number;
  hiddenByCategory: number;
  hiddenByCompletion: number;
  /** Hidden by the active saved view's status/kind/range rules. */
  hiddenByView: number;
}

/**
 * The same filtering, but showing its working.
 *
 * An empty list can only explain itself if it knows *what* emptied it, and
 * "nothing matches your filters" is a very different message from "you finished
 * everything". The counts are deliberately disjoint — each is measured against
 * what survived the stage before it, in the same order `applyItemFilters`
 * applies them — so they sum to the number of things that vanished and the copy
 * can add them up without lying.
 */
export function filterBreakdown(
  items: Item[],
  opts: {
    categoryFilter: string[] | null;
    hideCompleted?: boolean;
    viewFilter?: ViewFilter | null;
    now?: Date;
    weekStartsOn?: 0 | 1;
  }
): FilterBreakdown {
  const byCategory = applyCategoryFilter(items, opts.categoryFilter);
  const byCompletion = opts.hideCompleted
    ? byCategory.filter((i) => i.type === "event" || i.status !== "done")
    : byCategory;
  const visible = opts.viewFilter
    ? applyViewFilter(byCompletion, opts.viewFilter, opts.now ?? new Date(), opts.weekStartsOn ?? 0)
    : byCompletion;
  return {
    visible,
    total: items.length,
    hiddenByCategory: items.length - byCategory.length,
    hiddenByCompletion: byCategory.length - byCompletion.length,
    hiddenByView: byCompletion.length - visible.length,
  };
}
