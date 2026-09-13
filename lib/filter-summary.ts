import type { Category } from "./types";

/**
 * What the filters are currently doing, in words.
 *
 * A filter you cannot see is a bug report waiting to happen: "my assignment
 * disappeared" is almost always "a class is deselected and nothing on screen
 * says so". The dot on the filter button was the only tell, and a dot does not
 * say *what* is filtered. This turns the raw state into the one line the UI
 * shows — "2 classes · Incomplete" — plus the long form screen readers get.
 */

export interface FilterSummary {
  active: boolean;
  /** Short chips, in reading order. Empty when nothing is filtered. */
  parts: string[];
  /** "2 classes · Incomplete" — the compact indicator. */
  label: string;
  /** Spelled out for assistive tech, with the class names. */
  announcement: string;
}

export function summariseFilters(
  categories: Category[],
  categoryFilter: string[] | null,
  hideCompleted: boolean,
  /** Name of the saved view in force, if one is. It leads, because it is the
   *  thing that set everything else. */
  viewName?: string | null
): FilterSummary {
  const parts: string[] = [];
  const spoken: string[] = [];

  const view = viewName?.trim();
  if (view) {
    parts.push(view);
    spoken.push(`the ${view} view`);
  }

  // Ids can outlive the class they pointed at (deleted on another device), and
  // counting those would claim a filter the user cannot see or clear.
  const byId = new Map(categories.map((c) => [c.id, c] as const));
  const selected = (categoryFilter ?? []).filter((id) => byId.has(id));

  if (selected.length > 0) {
    const names = selected.map((id) => byId.get(id)!.name);
    parts.push(
      selected.length === 1 ? names[0] : `${selected.length} classes`
    );
    spoken.push(
      selected.length === 1
        ? `class ${names[0]}`
        : `${selected.length} classes: ${names.join(", ")}`
    );
  }

  if (hideCompleted) {
    parts.push("Incomplete");
    spoken.push("completed items hidden");
  }

  const active = parts.length > 0;
  return {
    active,
    parts,
    label: parts.join(" · "),
    announcement: active ? `Filtered by ${spoken.join(", and ")}` : "No filters",
  };
}
