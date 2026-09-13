import { addDays, startOfDay } from "date-fns";
import type { Item } from "./types";

/** Planned sessions for one assignment or task, earliest first. */
export function workSessionsFor(items: Item[], id: string): Item[] {
  return items
    .filter((i) => i.workFor === id)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Minutes of time blocked out across a set of sessions. */
export function plannedMinutes(sessions: Item[]): number {
  let total = 0;
  for (const s of sessions) {
    if (!s.endAt) continue;
    const ms = new Date(s.endAt).getTime() - new Date(s.at).getTime();
    if (Number.isFinite(ms) && ms > 0) total += Math.round(ms / 60_000);
  }
  return total;
}

/** "45m", "1h", "1h 30m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

interface Interval {
  start: number;
  end: number;
}

function busyIntervals(items: Item[]): Interval[] {
  const out: Interval[] = [];
  for (const i of items) {
    if (i.type !== "event" || i.allDay) continue;
    const start = new Date(i.at).getTime();
    if (Number.isNaN(start)) continue;
    const endRaw = i.endAt ? new Date(i.endAt).getTime() : start + 45 * 60_000;
    const end = Number.isNaN(endRaw) || endRaw <= start ? start + 45 * 60_000 : endRaw;
    out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * The first gap of `minutes` between timed events, on a quarter-hour, inside
 * waking hours, starting no earlier than `from`. Stops at `before` (a deadline)
 * when one is given, so "find time" never plans work after the thing is due.
 */
export function findFreeSlot(
  items: Item[],
  opts: {
    from: Date;
    minutes: number;
    dayStartHour?: number;
    dayEndHour?: number;
    days?: number;
    before?: Date;
  }
): Date | null {
  const step = 15 * 60_000;
  const length = Math.max(15, opts.minutes) * 60_000;
  const dayStartHour = opts.dayStartHour ?? 8;
  const dayEndHour = opts.dayEndHour ?? 22;
  const busy = busyIntervals(items);
  const limit = opts.before?.getTime() ?? Number.POSITIVE_INFINITY;
  const firstDay = startOfDay(opts.from);

  for (let d = 0; d < (opts.days ?? 7); d++) {
    const day = addDays(firstDay, d);
    const open = new Date(day);
    open.setHours(dayStartHour, 0, 0, 0);
    const close = new Date(day);
    close.setHours(dayEndHour, 0, 0, 0);
    let t = Math.max(open.getTime(), Math.ceil(opts.from.getTime() / step) * step);
    while (t + length <= close.getTime()) {
      if (t + length > limit) return null;
      const clash = busy.find((b) => b.start < t + length && b.end > t);
      if (!clash) return new Date(t);
      // Jump past the event in the way, back onto the quarter-hour grid.
      t = Math.max(t + step, Math.ceil(clash.end / step) * step);
    }
  }
  return null;
}
