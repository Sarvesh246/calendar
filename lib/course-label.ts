import { useMemo } from "react";
import { useDatebookStore } from "./store";
import { categoryLabel, courseLabels, parseCourseName } from "./course-name";
import type { Category } from "./types";

export * from "./course-name";

/** `(category) => label` bound to the live class list. */
export function useCourseLabels() {
  const categories = useDatebookStore((s) => s.categories);
  return useMemo(() => {
    const labels = courseLabels(categories);
    const of = (category: Pick<Category, "id" | "name"> | undefined | null) =>
      category ? (labels.get(category.id) ?? parseCourseName(category.name)) : undefined;
    return {
      of,
      label: (category: Pick<Category, "id" | "name"> | undefined | null, fallback = "No class") =>
        of(category)?.label ?? fallback,
    };
  }, [categories]);
}

/**
 * `classLabel(category)` for render code that already re-renders when the
 * class list changes (it reads the live list without subscribing). Shares the
 * collision handling, so two `ENGR 102`s still read apart in pickers.
 */
export function classLabel(category: Pick<Category, "id" | "name"> | undefined | null, fallback = "No class"): string {
  if (!category) return fallback;
  return categoryLabel(useDatebookStore.getState().categories, category);
}
