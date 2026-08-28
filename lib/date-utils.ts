import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isTomorrow,
  isYesterday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Item } from "./types";

export function formatTime(iso: string, clock24h: boolean) {
  return format(new Date(iso), clock24h ? "HH:mm" : "h:mm a");
}

export function monthGrid(anchor: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn });
  return eachDayOfInterval({ start, end }).map((date) => ({
    date,
    inMonth: isSameMonth(date, anchor),
  }));
}

export function weekDays(anchor: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(anchor, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/**
 * Inclusive local calendar-day span for an item. RFC 5545 all-day DTEND is
 * exclusive; timed events that end exactly at midnight of a later day follow
 * the same convention (Google/Outlook). Caps at 366 days so a corrupt endAt
 * can't explode the month grid.
 */
export function itemDaySpan(item: Item): { start: Date; last: Date } {
  const start = startOfDay(new Date(item.at));
  if (!item.endAt) return { start, last: start };
  const end = new Date(item.endAt);
  if (Number.isNaN(end.getTime())) return { start, last: start };
  let last = startOfDay(end);
  const exclusive =
    Boolean(item.allDay) ||
    (end.getHours() === 0 &&
      end.getMinutes() === 0 &&
      end.getSeconds() === 0 &&
      end.getTime() !== new Date(item.at).getTime());
  if (exclusive) last = addDays(last, -1);
  if (last < start) last = start;
  const max = addDays(start, 365);
  if (last > max) last = max;
  return { start, last };
}

export function itemOccupiesDay(item: Item, day: Date) {
  const { start, last } = itemDaySpan(item);
  const key = startOfDay(day).getTime();
  return key >= start.getTime() && key <= last.getTime();
}

export function itemsOnDay(items: Item[], day: Date) {
  return items
    .filter((i) => itemOccupiesDay(i, day))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Stable local-day key (`yyyy-MM-dd`) for bucketing/looking items up by day. */
export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/**
 * Bucket every item by its local calendar day, each bucket sorted by start time.
 * One O(n) pass, done once per item-list change — the calendar grids then look
 * each day up in O(1) instead of re-filtering the whole list per rendered cell
 * (42 cells/month, 14/week), which was blocking the view-switch interaction.
 */
export function groupItemsByDay(items: Item[]): Map<string, Item[]> {
  const map = new Map<string, Item[]>();
  for (const item of items) {
    const { start, last } = itemDaySpan(item);
    for (let d = start; d.getTime() <= last.getTime(); d = addDays(d, 1)) {
      const key = dayKey(d);
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }
  return map;
}

export function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMMM d");
}

export function relativeDueLabel(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Due today";
  if (isTomorrow(date)) return "Due tomorrow";
  if (isYesterday(date)) return "Overdue — was due yesterday";
  if (date.getTime() < Date.now()) return `Overdue — was due ${format(date, "MMM d")}`;
  return `Due ${format(date, "EEE, MMM d")}`;
}

export function isOverdue(item: Item) {
  if (item.type === "event" || item.status === "done") return false;
  return new Date(item.at).getTime() < Date.now() && !isToday(new Date(item.at));
}

export function timeOfDayGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return { label: "Late night", sub: "Still up?" };
  if (hour < 12) return { label: "Good morning", sub: "Here's your day." };
  if (hour < 17) return { label: "Your afternoon", sub: "Here's what's left." };
  if (hour < 21) return { label: "Your evening", sub: "Winding down." };
  return { label: "Wrapping up", sub: "Here's tomorrow, at a glance." };
}

export function workloadIntensity(count: number) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}
