"use client";

import { useMemo } from "react";
import { useDatebookStore } from "@/lib/store";
import type { Category } from "@/lib/types";

export type ItemCardChrome = {
  clock24h: boolean;
  showLocation: boolean;
  showCategoryDot: boolean;
};

/** One settings subscription for a whole list, not one per card. */
export function useItemCardChrome(): ItemCardChrome {
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const showLocation = useDatebookStore((s) => s.settings.showLocation);
  const showCategoryDot = useDatebookStore((s) => s.settings.showCategoryDot);
  return { clock24h, showLocation, showCategoryDot };
}

export function useCategoriesById() {
  const categories = useDatebookStore((s) => s.categories);
  return useMemo(() => {
    const map = new Map<string, Category>();
    for (const category of categories) map.set(category.id, category);
    return map;
  }, [categories]);
}
