import { sanitizeCustomTheme } from "./custom-theme";
import { safeCategoryColor, safeCategoryName, safePresetLabel } from "./db-sync";
import type {
  Category,
  ImportSource,
  Item,
  ItemStatus,
  ItemType,
  LandingView,
  ReminderPreset,
  UserSettings,
} from "./types";

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
  const customTheme = sanitizeCustomTheme(base.customTheme);
  const customUnchanged =
    (!base.customTheme && !customTheme) ||
    (!!customTheme &&
      !!base.customTheme &&
      customTheme.background === base.customTheme.background &&
      customTheme.surface === base.customTheme.surface &&
      customTheme.accent === base.customTheme.accent);
  if (landingView === base.landingView && customUnchanged && settings) return settings;
  const next: UserSettings = { ...base, landingView };
  if (customTheme) next.customTheme = customTheme;
  else delete next.customTheme;
  return next;
}

const ITEM_TYPES = new Set<ItemType>(["event", "assignment", "task"]);
const ITEM_STATUSES = new Set<ItemStatus>(["todo", "doing", "done"]);

function isoOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * Repair — or drop — items that can't be rendered.
 *
 * `at` is the one field with no safe default: every view formats it, and
 * date-fns `format` *throws* on an invalid date, so a single unparseable `at`
 * takes down whichever page touches it. Persisted in localStorage, that is a
 * crash the user cannot get out of by reloading. Restoring a hand-edited or
 * truncated backup was the way in — `parseBackup` checked that `items` was an
 * array and trusted every element of it.
 *
 * So: anything without a usable id or `at` is dropped, duplicate ids are
 * collapsed (they also collide as React keys), and the remaining fields are
 * coerced back into range rather than thrown away. Returns the original array
 * when nothing needed fixing, so a clean rehydrate doesn't look like an edit to
 * the sync engine.
 */
export function sanitizeItems(items: Item[] | undefined): Item[] {
  if (!Array.isArray(items)) return [];
  const out: Item[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      changed = true;
      continue;
    }
    const i = raw as Item;
    const at = isoOrUndefined(i.at);
    if (typeof i.id !== "string" || !i.id || !at || seen.has(i.id)) {
      changed = true;
      continue;
    }
    seen.add(i.id);

    const title = typeof i.title === "string" ? i.title : "";
    const type: ItemType = ITEM_TYPES.has(i.type) ? i.type : "task";
    const createdAt = isoOrUndefined(i.createdAt) ?? at;
    const endAt = isoOrUndefined(i.endAt);
    const status =
      i.status !== undefined && ITEM_STATUSES.has(i.status) ? i.status : undefined;
    const reminders = Array.isArray(i.reminders)
      ? i.reminders.filter((r) => r && typeof r === "object")
      : undefined;

    const next: Item = { ...i, id: i.id, title, type, at, createdAt };
    if (endAt) next.endAt = endAt;
    else delete next.endAt;
    if (status) next.status = status;
    else delete next.status;
    if (reminders?.length) next.reminders = reminders;
    else delete next.reminders;
    for (const key of ["completedAt", "statusAt", "updatedAt"] as const) {
      const v = isoOrUndefined(i[key]);
      if (v) next[key] = v;
      else delete next[key];
    }

    if (JSON.stringify(next) === JSON.stringify(i)) out.push(i);
    else {
      changed = true;
      out.push(next);
    }
  }

  return changed ? out : items;
}
