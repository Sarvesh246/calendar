import { isClassScheduleItem } from "./class-schedule";
import type { Item, Reminder } from "./types";

/* ------------------------------------------------------------------ */
/* Class heads-up timing                                               */
/* ------------------------------------------------------------------ */
/* One number drives both halves of "your class is about to start":    */
/* the Today countdown card, and the reminder notification (in-tab     */
/* timers and closed-app web push alike). It lives in settings rather  */
/* than on each class item so changing it re-times every class at once */
/* — including classes already synced to other devices — instead of    */
/* rewriting every meeting's `reminders` array through the sync queue. */

export const DEFAULT_CLASS_REMINDER_MINUTES = 10;

/** Offsets offered in Settings — eight, so they tile as an even grid at any
 *  width. `0` means no countdown and no alert. */
export const CLASS_REMINDER_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60] as const;

const MAX_CLASS_REMINDER_MINUTES = 24 * 60;

/** Coerce anything persisted, synced, or hand-edited into a usable offset. */
export function normalizeClassReminderMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_CLASS_REMINDER_MINUTES;
  }
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.min(rounded, MAX_CLASS_REMINDER_MINUTES);
}

/** How far ahead the Today countdown card opens, in ms. */
export function classCountdownWindowMs(minutes: number): number {
  return normalizeClassReminderMinutes(minutes) * 60_000;
}

/** Chip copy: "Off", "5 min", "1 hr". */
export function classReminderOptionLabel(minutes: number): string {
  if (minutes <= 0) return "Off";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hr" : `${hours} hr`;
  }
  return `${minutes} min`;
}

/** Notification copy: "10 minutes before". */
export function classReminderLabel(minutes: number): string {
  if (minutes <= 0) return "At start time";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour before" : `${hours} hours before`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"} before`;
}

/** Stable per-offset id, so re-timing doesn't replay an already-fired alert. */
export function classReminderId(minutes: number): string {
  return `class-${minutes}`;
}

/** True for a reminder this module invented rather than one the user attached. */
export function isSynthesizedClassReminder(reminder: Pick<Reminder, "id">): boolean {
  return reminder.id.startsWith("class-");
}

/**
 * The heads-up reminder for one class meeting, or `null` when it doesn't get
 * one: alerts are off, the item isn't a weekly class meeting, it's already
 * done, or the user attached their own reminder at that exact offset (in which
 * case theirs wins and this would just be a duplicate notification).
 *
 * Nothing here is persisted — it's recomputed from settings every time the
 * reminder pass runs, on the client and in the push dispatcher alike.
 */
export function classReminderFor(
  item: Pick<Item, "id" | "type" | "allDay" | "sourceId" | "repeat" | "status" | "reminders">,
  minutes: number
): Reminder | null {
  const offsetMinutes = normalizeClassReminderMinutes(minutes);
  if (offsetMinutes <= 0) return null;
  if (item.status === "done") return null;
  if (!isClassScheduleItem(item as Item)) return null;
  if (item.reminders?.some((r) => r.offsetMinutes === offsetMinutes)) return null;
  return {
    id: classReminderId(offsetMinutes),
    itemId: item.id,
    offsetMinutes,
    label: classReminderLabel(offsetMinutes),
  };
}
