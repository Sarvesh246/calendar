import { weekdayStamp } from "./assistant-dates";
import { wallTimeInZoneToIso } from "./date-utils";

/**
 * "Am I free then?" answered in code. The audit's model said "Yes, you are free
 * at 7:00 PM on Thursday" with a 7 PM event in front of it: a list is easy to
 * misread, a boolean computed here is not.
 */

export interface AvailabilityItem {
  id: string;
  title: string;
  type: string;
  at: string;
  endAt?: string | null;
  allDay?: boolean | null;
  status?: string | null;
}

export interface Conflict {
  id: string;
  title: string;
  /** `Thu 2026-11-12 19:00` in the user's zone, ready to quote. */
  start: string;
  end?: string;
}

export interface AvailabilityResult {
  free: boolean;
  /** Timed events that overlap the window. Any of these makes it not free. */
  conflicts: Conflict[];
  /** All-day events on the window: shown, but they do not block a time. */
  allDay: Conflict[];
}

/** An event with no end still occupies its slot. */
const DEFAULT_EVENT_MINUTES = 60;

export function checkAvailability(
  items: AvailabilityItem[],
  startIso: string,
  endIso: string,
  timeZone: string,
): AvailabilityResult {
  const start = +new Date(startIso);
  const end = +new Date(endIso);
  const conflicts: Conflict[] = [];
  const allDay: Conflict[] = [];
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return { free: true, conflicts, allDay };
  }
  // A zero-length question ("at 7pm") asks about that instant.
  const windowEnd = end === start ? start + 1 : end;

  for (const item of items) {
    if (item.type !== "event") continue;
    const at = +new Date(item.at);
    if (Number.isNaN(at)) continue;
    const row: Conflict = {
      id: item.id,
      title: item.title,
      start: weekdayStamp(item.at, timeZone),
      ...(item.endAt ? { end: weekdayStamp(item.endAt, timeZone) } : {}),
    };
    if (item.allDay) {
      // All-day: any overlap with the calendar day is informational.
      const dayKey = (iso: string) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(iso));
      const startKey = dayKey(item.at);
      const startOfDay = +new Date(wallTimeInZoneToIso(startKey, 0, 0, timeZone));
      let endKey = item.endAt ? dayKey(item.endAt) : "";
      if (!endKey || endKey <= startKey) {
        const next = new Date(`${startKey}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        endKey = next.toISOString().slice(0, 10);
      }
      const dayEnd = +new Date(wallTimeInZoneToIso(endKey, 0, 0, timeZone));
      if (startOfDay < windowEnd && dayEnd > start) allDay.push(row);
      continue;
    }
    const finish = item.endAt ? +new Date(item.endAt) : at + DEFAULT_EVENT_MINUTES * 60_000;
    const itemEnd =
      Number.isNaN(finish) || finish <= at ? at + DEFAULT_EVENT_MINUTES * 60_000 : finish;
    if (at < windowEnd && itemEnd > start) conflicts.push(row);
  }
  conflicts.sort((a, b) => a.start.localeCompare(b.start));
  return { free: conflicts.length === 0, conflicts, allDay };
}

/** Find non-overlapping slots within a bounded window, using the same conflict rules. */
export function findFreeTime(
  items: AvailabilityItem[],
  startIso: string,
  endIso: string,
  minutes: number,
  timeZone: string,
  limit = 5,
) {
  const start = +new Date(startIso);
  const end = +new Date(endIso);
  const step = 15 * 60_000;
  const duration = minutes * 60_000;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    end <= start ||
    end - start > 31 * 86_400_000
  )
    return [];
  const slots: { start: string; end: string }[] = [];
  for (
    let t = Math.ceil(start / step) * step;
    t + duration <= end && slots.length < limit;
    t += step
  ) {
    const a = new Date(t).toISOString();
    const b = new Date(t + duration).toISOString();
    if (checkAvailability(items, a, b, timeZone).free) {
      slots.push({ start: a, end: b });
      t += Math.max(0, duration - step);
    }
  }
  return slots;
}
