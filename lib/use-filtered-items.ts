"use client";

import { useDeferredValue, useMemo } from "react";
import { useDatebookStore } from "./store";
import { useDeferredCategoryFilter, useUIStore } from "./ui-store";
import { applyItemFilters } from "./filters";
import { useNow } from "./use-now";
import type { Item } from "./types";

/**
 * Items as every main view should see them: class filter, "hide completed",
 * and the active saved view. Filters are deferred so tapping one lets the
 * control respond before the lists re-render.
 */
export function useFilteredItems(): Item[] {
  const allItems = useDatebookStore((s) => s.items);
  const hideCompleted = useDatebookStore((s) => s.settings.hideCompleted);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const categoryFilter = useDeferredCategoryFilter();
  const viewFilter = useDeferredValue(useUIStore((s) => s.viewFilter));
  const now = useNow();
  // Only a time-bound view needs to re-run as the clock moves.
  const range = viewFilter?.range ?? "any";
  const clockKey =
    range === "any" ? "" : range === "overdue" ? String(Math.floor(now.getTime() / 60_000)) : now.toDateString();

  return useMemo(
    () =>
      applyItemFilters(allItems, {
        categoryFilter,
        hideCompleted,
        viewFilter,
        now: new Date(),
        weekStartsOn,
      }),
    // `clockKey` stands in for `now`, so the list only recomputes when it matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allItems, categoryFilter, hideCompleted, viewFilter, weekStartsOn, clockKey]
  );
}
