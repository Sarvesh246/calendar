import type { Category, ImportSource, LandingView, UserSettings } from "./types";

const LANDING_VIEWS = new Set<LandingView>(["today", "calendar", "agenda"]);

/** Repair categories that lost a name in localStorage or cloud sync. */
export function sanitizeCategories(categories: Category[]): Category[] {
  let changed = false;
  const next = categories.map((c) => {
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (name && name === c.name) return c;
    changed = true;
    return { ...c, name: name || "Uncategorized" };
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
