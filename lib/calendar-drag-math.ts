import { addDays, addMinutes, differenceInCalendarDays } from "date-fns";
import type { Item } from "./types";

/** Every drag lands on this grid, and its preview snaps to the same step. */
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** `yyyy-MM-dd` → local midnight. Never `new Date(key)`, which reads it as UTC. */
export function dateFromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Local wall-clock time `minute` minutes into the day `key`. */
export function dayAtMinute(key: string, minute: number): Date {
  const date = dateFromDayKey(key);
  date.setHours(0, minute, 0, 0);
  return date;
}

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

type Timed = Pick<Item, "at" | "endAt">;

/**
 * Move a timed item so the segment drawn on `sourceDayKey` (starting at
 * `sourceStartMin`) begins at `targetStartMin` on `targetDayKey`.
 *
 * A single-day item lands exactly on the target wall-clock time and keeps its
 * real length. A multi-day item being dragged by one of its later segments
 * shifts as a whole by the same day and minute offset.
 */
export function movedTimes(
  item: Timed,
  sourceDayKey: string,
  sourceStartMin: number,
  targetDayKey: string,
  targetStartMin: number
): { at: string; endAt?: string } {
  const start = new Date(item.at);
  const end = item.endAt ? new Date(item.endAt) : undefined;
  const sourceDay = dateFromDayKey(sourceDayKey);
  if (differenceInCalendarDays(start, sourceDay) === 0) {
    const at = dayAtMinute(targetDayKey, targetStartMin);
    return {
      at: at.toISOString(),
      ...(end ? { endAt: new Date(at.getTime() + (end.getTime() - start.getTime())).toISOString() } : {}),
    };
  }
  const dayDiff = differenceInCalendarDays(dateFromDayKey(targetDayKey), sourceDay);
  const minuteDiff = targetStartMin - sourceStartMin;
  const shift = (d: Date) => addMinutes(addDays(d, dayDiff), minuteDiff).toISOString();
  return { at: shift(start), ...(end ? { endAt: shift(end) } : {}) };
}

/** Same time of day, `days` later (or earlier) — across DST, by the wall clock. */
export function shiftedByDays(item: Timed, days: number): { at: string; endAt?: string } {
  return {
    at: addDays(new Date(item.at), days).toISOString(),
    ...(item.endAt ? { endAt: addDays(new Date(item.endAt), days).toISOString() } : {}),
  };
}

/** Days between the cell an item was dragged from and the one it landed on. */
export function dayDelta(fromKey: string, toKey: string): number {
  return differenceInCalendarDays(dateFromDayKey(toKey), dateFromDayKey(fromKey));
}

/** New end for a bottom-edge resize — never shorter than the minimum length. */
export function resizedEnd(item: Pick<Item, "at">, dayKey: string, endMin: number): string {
  const start = new Date(item.at).getTime();
  const end = dayAtMinute(dayKey, endMin).getTime();
  return new Date(Math.max(end, start + MIN_DURATION_MINUTES * 60_000)).toISOString();
}

/**
 * The span swept by dragging across empty time, whichever way the pointer
 * went, snapped and kept inside the visible hours.
 */
export function sweptRange(
  anchorMin: number,
  currentMin: number,
  minMinute: number,
  maxMinute: number
): { startMin: number; endMin: number } {
  const clamp = (m: number) => Math.max(minMinute, Math.min(maxMinute, m));
  const a = clamp(Math.floor(anchorMin / SNAP_MINUTES) * SNAP_MINUTES);
  const b = clamp(snapMinutes(currentMin));
  let startMin = Math.min(a, b);
  let endMin = Math.max(a, b);
  if (b <= a) endMin = Math.max(endMin, a + SNAP_MINUTES);
  if (endMin - startMin < SNAP_MINUTES) endMin = startMin + SNAP_MINUTES;
  if (endMin > maxMinute) {
    endMin = maxMinute;
    startMin = Math.min(startMin, endMin - SNAP_MINUTES);
  }
  return { startMin, endMin };
}
