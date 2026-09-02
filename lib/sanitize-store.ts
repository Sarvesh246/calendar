import { safeCategoryColor, safeCategoryName } from "./db-sync";
import type { Category, ImportSource, LandingView, UserSettings } from "./types";

const LANDING_VIEWS = new Set<LandingView>(["today", "calendar", "agenda"]);

/** Repair categories that lost a name or colour in localStorage or cloud sync.
 *  A colourless category is not just a rendering problem: `categories.color` is
 *  NOT NULL, so pushing one used to fail every subsequent write in the queue. */
export function sanitizeCategories(categories: Category[]): Category[] {
  let changed = false;
  const next = categories.map((c) => {
    const name = safeCategoryName(c.name);
    const color = safeCategoryColor(c.color);
    if (name === c.name && color === c.color) return c;
    changed = true;
    return { ...c, name, color };
  });
  return changed ? next : categories;
}

export function sanitizeImportSources(sources: ImportSource[]): ImportSource[] {
  let changed = false;
  const next = sources.map((s) => {
    const name = typeof s.name === "string" ? s.name.trim() : "";
    if (name && name === s.name) return s;
    changed = true;
    return { ...s, name: name || "Calendar feed" };
  });
  return changed ? next : sources;
}

export function sanitizeSettings(settings: UserSettings | undefined): UserSettings {
  const base = settings ?? ({} as UserSettings);
  const landingView = LANDING_VIEWS.has(base.landingView) ? base.landingView : "today";
  if (landingView === base.landingView && settings) return settings;
  return { ...base, landingView };
}
