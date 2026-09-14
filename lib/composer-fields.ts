import { addDays, format, isSameDay } from "date-fns";
import type { Category } from "./types";

/**
 * What the quick-add composer is actually about to create, and where each part
 * of that came from.
 *
 * Quick add parses a sentence. That is lovely when it works and silently wrong
 * when it doesn't — "Math homework tomorrow" is unambiguous, "Math hw thurs"
 * less so, and until now the only way to find out which day it picked was to
 * add the item and go looking. The preview step helped, but it arrived *after*
 * you had committed to adding, which is the wrong moment to discover the date
 * is wrong.
 *
 * So the composer shows three chips the whole time — day, class, reminder —
 * each one filled in by the most specific thing that knows the answer:
 *
 *   1. an override: you tapped the chip and chose
 *   2. the sentence: you typed "tomorrow" or "#bio"
 *   3. the context: you opened Add from a day on the calendar, or with a
 *      single class filtered
 *   4. the app's own default
 *
 * Keeping the resolution here, away from React, is what makes "which day will
 * this land on" a question with a testable answer.
 */

export type FieldSource = "override" | "typed" | "context" | "default";

export interface ComposerContext {
  /** `yyyy-MM-dd` of the day the add started from, if any. */
  dateKey: string | null;
  /** Class implied by where the add started — a single filtered class. */
  categoryId: string | null;
  /** The app's default reminder offset in minutes, or null for none. */
  defaultReminderMinutes: number | null;
  /**
   * The class an item lands in when nothing else picks one. The chip has to
   * name it: saying "No class" and then filing the item under the first class
   * anyway is the chip lying about the thing it exists to tell you.
   */
  fallbackCategoryId?: string;
}

export interface ComposerOverrides {
  /** `yyyy-MM-dd`. */
  dateKey?: string;
  categoryId?: string;
  /** Minutes before; `0` means "no reminder", which is a real choice. */
  reminderMinutes?: number;
}

export interface ResolvedField<T> {
  value: T;
  source: FieldSource;
}

export interface ResolvedComposer {
  date: ResolvedField<Date>;
  categoryId: ResolvedField<string | undefined>;
  reminderMinutes: ResolvedField<number | null>;
}

export interface ComposerParse {
  at: Date;
  categoryId?: string;
  reminderMinutesBefore?: number;
  confidence: { date: boolean; category: boolean; reminder: boolean };
}

function dayFromKey(key: string): Date | null {
  const parsed = new Date(`${key}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Move a parsed instant onto another calendar day, keeping its time of day.
 * Built from local parts rather than arithmetic on the epoch so a DST boundary
 * between the two days doesn't shift the clock time by an hour.
 */
export function onDay(at: Date, day: Date): Date {
  const next = new Date(day);
  next.setHours(at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds());
  return next;
}

export function resolveComposer(
  parse: ComposerParse | null,
  context: ComposerContext,
  overrides: ComposerOverrides
): ResolvedComposer {
  // --- day ---------------------------------------------------------------
  const base = parse?.at ?? new Date();
  let date: ResolvedField<Date>;
  const overrideDay = overrides.dateKey ? dayFromKey(overrides.dateKey) : null;
  const contextDay = context.dateKey ? dayFromKey(context.dateKey) : null;
  if (overrideDay) {
    date = { value: onDay(base, overrideDay), source: "override" };
  } else if (parse?.confidence.date) {
    // The parser already folds the context day in as its anchor, so a confident
    // parse is either something you typed or that same context — either way it
    // is the most specific answer available.
    date = { value: base, source: contextDay ? "context" : "typed" };
  } else if (contextDay) {
    date = { value: onDay(base, contextDay), source: "context" };
  } else {
    date = { value: base, source: "default" };
  }

  // --- class -------------------------------------------------------------
  let categoryId: ResolvedField<string | undefined>;
  if (overrides.categoryId !== undefined) {
    categoryId = { value: overrides.categoryId, source: "override" };
  } else if (parse?.confidence.category && parse.categoryId) {
    categoryId = { value: parse.categoryId, source: "typed" };
  } else if (context.categoryId) {
    categoryId = { value: context.categoryId, source: "context" };
  } else {
    categoryId = { value: parse?.categoryId ?? context.fallbackCategoryId, source: "default" };
  }

  // --- reminder ----------------------------------------------------------
  let reminderMinutes: ResolvedField<number | null>;
  if (overrides.reminderMinutes !== undefined) {
    // 0 is "none", and has to survive as a deliberate choice rather than
    // falling through to the default the way a falsy check would let it.
    const value = overrides.reminderMinutes === 0 ? null : overrides.reminderMinutes;
    reminderMinutes = { value, source: "override" };
  } else if (parse?.confidence.reminder && parse.reminderMinutesBefore) {
    reminderMinutes = { value: parse.reminderMinutesBefore, source: "typed" };
  } else {
    reminderMinutes = { value: context.defaultReminderMinutes, source: "default" };
  }

  return { date, categoryId, reminderMinutes };
}

/**
 * "Today", "Tomorrow", "Fri 14 Mar" — short enough for a chip.
 *
 * Compared against the `now` it is handed rather than date-fns's `isToday` /
 * `isTomorrow`, which read the real clock: a label that cannot be asked about
 * a different day is a label that cannot be tested.
 */
export function dayChipLabel(date: Date, now = new Date()): string {
  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, addDays(now, 1))) return "Tomorrow";
  if (isSameDay(date, addDays(now, -1))) return "Yesterday";
  return format(date, "EEE d MMM");
}

export function classChipLabel(
  categoryId: string | undefined,
  categories: Category[]
): string {
  if (!categoryId) return "No class";
  return categories.find((c) => c.id === categoryId)?.name ?? "No class";
}

export function reminderChipLabel(minutes: number | null): string {
  if (minutes === null) return "No reminder";
  if (minutes === 0) return "At the time";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 day before" : `${days} days before`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return `${minutes} min before`;
}

/** The reminder offsets the chip offers, in the order it offers them. */
export const REMINDER_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 0, label: "No reminder" },
  { minutes: 10, label: "10 min before" },
  { minutes: 30, label: "30 min before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 2880, label: "2 days before" },
];
