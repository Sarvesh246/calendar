import { safeCategoryColor, safeCategoryName, safePresetLabel } from "./db-sync";
import type { Category, ImportSource, LandingView, ReminderPreset, UserSettings } from "./types";

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

/** Repair presets that lost a label or offset in localStorage or cloud sync.
 *  `reminder_presets.label` and `.offset_minutes` are NOT NULL, so pushing one
 *  used to fail every subsequent write in the queue. */
export function sanitizeReminderPresets(presets: ReminderPreset[]): ReminderPreset[] {
  let changed = false;
  const next = presets.map((p) => {
    const label = safePresetLabel(p.label);
    const offsetMinutes =
      typeof p.offsetMinutes === "number" && Number.isFinite(p.offsetMinutes) ? p.offsetMinutes : 15;
    if (label === p.label && offsetMinutes === p.offsetMinutes) return p;
    changed = true;
    return { ...p, label, offsetMinutes };
  });
  return changed ? next : presets;
}

/** Settings only ever surfaces ~4 built-in presets plus whatever the user adds
 *  by hand, so a list past this is corrupted data, not intent. */
const MAX_REMINDER_PRESETS = 16;

/** Collapse presets that share an offset down to one (a duplicate offset is
 *  never a deliberate choice — two rows both meaning "15 minutes before" are
 *  the same reminder), preferring whichever copy has a real label over the
 *  generic "Reminder" fallback, and cap the result. Repairs a store that
 *  picked up repeat entries from a stale sync loop. */
export function dedupeReminderPresets(presets: ReminderPreset[]): ReminderPreset[] {
  const byOffset = new Map<number, ReminderPreset>();
  for (const p of presets) {
    const existing = byOffset.get(p.offsetMinutes);
    if (!existing || (existing.label === "Reminder" && p.label !== "Reminder")) {
      byOffset.set(p.offsetMinutes, p);
    }
  }
  let deduped = [...byOffset.values()];
  if (deduped.length > MAX_REMINDER_PRESETS) {
    deduped = deduped
      .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
      .slice(0, MAX_REMINDER_PRESETS);
  }
  return deduped.length === presets.length ? presets : deduped;
}

export function sanitizeSettings(settings: UserSettings | undefined): UserSettings {
  const base = settings ?? ({} as UserSettings);
  const landingView = LANDING_VIEWS.has(base.landingView) ? base.landingView : "today";
  if (landingView === base.landingView && settings) return settings;
  return { ...base, landingView };
}
