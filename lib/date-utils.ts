import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getDay,
  isSameMonth,
  isToday,
  isTomorrow,
  isYesterday,
  nextDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type Day,
} from "date-fns";
import type { Item } from "./types";
import { isClassScheduleItem } from "./class-schedule";

/** date-fns `format` throws on an invalid date, and these three are called
 *  straight from render with whatever `item.at` holds. Store input is sanitised
 *  on the way in (see `sanitizeItems`), but a date that slips through should
 *  cost one label, not the whole page. */
const NO_DATE = "—";

export function formatTime(iso: string, clock24h: boolean) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return NO_DATE;
  return format(d, clock24h ? "HH:mm" : "h:mm a");
}

/** Offset of `timeZone` at `instant`, in milliseconds east of UTC. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  let hour = num("hour");
  if (hour === 24) hour = 0;
  const asUTC = Date.UTC(
    num("year"),
    num("month") - 1,
    num("day"),
    hour,
    num("minute"),
    num("second")
  );
  return asUTC - instant.getTime();
}

/** Convert a wall-clock time in `timeZone` to a UTC ISO string. */
export function wallTimeInZoneToIso(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offset1 = tzOffsetMs(new Date(utcGuess), timeZone);
  const instant = new Date(utcGuess - offset1);
  const offset2 = tzOffsetMs(instant, timeZone);
  return new Date(utcGuess - offset2).toISOString();
}

export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "yyyy-MM-dd");
}

export function datetimeLocalToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
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
  if (Number.isNaN(date.getTime())) return NO_DATE;
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMMM d");
}

export function relativeDueLabel(iso: string, opts?: { allDay?: boolean }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NO_DATE;
  const past = date.getTime() < Date.now();
  const overdue = past && !(opts?.allDay && isToday(date));
  if (overdue) {
    if (isToday(date)) return "Overdue";
    if (isYesterday(date)) return "Overdue since yesterday";
    return `Overdue since ${format(date, "MMM d")}`;
  }
  if (isToday(date)) return "Due today";
  if (isTomorrow(date)) return "Due tomorrow";
  return `Due ${format(date, "EEE, MMM d")}`;
}

export function isOverdue(item: Item) {
  if (item.type === "event" || item.status === "done") return false;
  const at = new Date(item.at);
  if (item.allDay) return !isToday(at) && at.getTime() < Date.now();
  return at.getTime() < Date.now();
}

/** "Monday" means today when today is Monday; otherwise the next that weekday. */
export function thisOrNextWeekday(dow: Day, from = new Date()) {
  const today = startOfDay(from);
  if (getDay(today) === dow) return today;
  return nextDay(today, dow);
}

/**
 * Local clock window for an event on `now`'s calendar day.
 *
 * A 9am–5pm career fair that spans two dates is happening 9–5 each day, not
 * for 32 straight hours. An overnight flight (10pm–6am) stays live through
 * the night. All-day events occupy the whole local day.
 */
export function eventSessionBounds(
  item: Item,
  now = new Date()
): { start: Date; end: Date } | null {
  if (item.type !== "event") return null;
  const start = new Date(item.at);
  if (Number.isNaN(start.getTime())) return null;
  if (!itemOccupiesDay(item, now)) return null;

  if (item.allDay) {
    const dayStart = startOfDay(now);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);
    return { start: dayStart, end: dayEnd };
  }

  const end = item.endAt ? new Date(item.endAt) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return null;

  const startDay = startOfDay(start).getTime();
  const endDay = startOfDay(end).getTime();
  if (startDay === endDay) return { start, end };

  const today = startOfDay(now).getTime();
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = end.getHours() * 60 + end.getMinutes();
  const overnight = endMin <= startMin;

  if (overnight) {
    if (today === startDay) {
      const sessionEnd = new Date(startOfDay(now));
      sessionEnd.setDate(sessionEnd.getDate() + 1);
      return { start, end: sessionEnd };
    }
    if (today === endDay) return { start: startOfDay(now), end };
    return {
      start: startOfDay(now),
      end: addDays(startOfDay(now), 1),
    };
  }

  const sessionStart = new Date(startOfDay(now));
  sessionStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), 0);
  const sessionEnd = new Date(startOfDay(now));
  sessionEnd.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), 0);
  if (sessionEnd.getTime() <= sessionStart.getTime()) return null;
  return { start: sessionStart, end: sessionEnd };
}

/** True when `item` is an event in progress on this local day. */
export function isHappeningNow(item: Item, now = new Date()): boolean {
  if (item.status === "done") return false;
  const bounds = eventSessionBounds(item, now);
  if (!bounds) return false;
  const t = now.getTime();
  return t >= bounds.start.getTime() && t < bounds.end.getTime();
}

/** Every open event currently in session, earliest start first. */
export function happeningNow(items: Item[], now = new Date()): Item[] {
  return items
    .filter((i) => i.status !== "done" && isHappeningNow(i, now))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** How far out a class-schedule meeting appears as a countdown card. */
export const CLASS_COUNTDOWN_MS = 10 * 60 * 1000;

export function isClassStartingSoon(
  item: Item,
  now = new Date(),
  windowMs = CLASS_COUNTDOWN_MS
): boolean {
  if (!isClassScheduleItem(item) || item.status === "done") return false;
  if (isHappeningNow(item, now)) return false;
  const start = new Date(item.at);
  if (Number.isNaN(start.getTime())) return false;
  const delta = start.getTime() - now.getTime();
  return delta > 0 && delta <= windowMs;
}

export function classStartingSoon(
  items: Item[],
  now = new Date(),
  windowMs = CLASS_COUNTDOWN_MS
): Item[] {
  return items
    .filter((i) => isClassStartingSoon(i, now, windowMs))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Tight countdown copy: "8 min", "45 sec", "Starting now". */
export function classCountdownLabel(start: Date, now = new Date()): string {
  const ms = start.getTime() - now.getTime();
  if (ms <= 0) return "Starting now";
  const totalSec = Math.max(1, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec} sec`;
  const min = Math.max(1, Math.round(ms / 60_000));
  return `${min} min`;
}

/**
 * Cards for Today's happening-now stack: live events (including class),
 * class meetings inside the 10-minute countdown, then a non-class up-next.
 */
export function happeningNowStack(
  items: Item[],
  now = new Date()
): { happening: Item[]; startingSoon: Item[]; upcoming?: Item } {
  const happening = happeningNow(items, now);
  const happeningIds = new Set(happening.map((i) => i.id));
  const startingSoon = classStartingSoon(items, now).filter((i) => !happeningIds.has(i.id));
  const busy = new Set([...happeningIds, ...startingSoon.map((i) => i.id)]);
  const upcoming = items
    .filter(
      (i) =>
        i.status !== "done" &&
        !busy.has(i.id) &&
        !isClassScheduleItem(i) &&
        new Date(i.at).getTime() > now.getTime()
    )
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0];
  return { happening, startingSoon, upcoming };
}

/**
 * Focus / "what's next": events happening now, else the next future item,
 * else the oldest incomplete overdue assignment.
 */
export function focusQueue(items: Item[], now = new Date()): { current?: Item; next?: Item } {
  const open = items.filter((i) => i.status !== "done");
  const live = happeningNow(open, now);
  const liveIds = new Set(live.map((i) => i.id));
  const upcoming = open
    .filter((i) => !liveIds.has(i.id) && new Date(i.at).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const overdue = open
    .filter(
      (i) =>
        i.type !== "event" &&
        !liveIds.has(i.id) &&
        new Date(i.at).getTime() < now.getTime()
    )
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const ordered = [...live, ...upcoming, ...overdue];
  return { current: ordered[0], next: ordered[1] };
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

/** Per-day open-item counts for the next 7 local days starting at `from`. */
export function weekWorkload(items: Item[], from = new Date(), weekStartsOn: 0 | 1 = 0) {
  const start = startOfWeek(startOfDay(from), { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const count = itemsOnDay(items, date).filter((it) => it.status !== "done").length;
    return { date, count, intensity: workloadIntensity(count), isToday: isToday(date) };
  });
}

/** Soonest open assignment or task — overdue first, then upcoming due dates. */
export function nextOpenAssignment(items: Item[]): Item | undefined {
  return items
    .filter((i) => i.type !== "event" && i.status !== "done")
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())[0];
}

/** Items that still occupy attention on a day: events plus unfinished work. */
export function openItemsOnDay(items: Item[]) {
  return items.filter((i) => i.type === "event" || i.status !== "done");
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * 60;

/**
 * Remaining-time copy for an event still going.
 *
 * iOS timer voice: minutes under an hour, hours + minutes under a day,
 * days (+ hours) after that. Never raw minute dumps like "1672m left".
 */
export function formatRemainingLabel(ms: number): string {
  const totalMin = Math.max(1, Math.round(Math.max(0, ms) / 60_000));

  if (totalMin < MIN_PER_HOUR) {
    return `${totalMin} min left`;
  }

  if (totalMin < MIN_PER_DAY) {
    const hours = Math.floor(totalMin / MIN_PER_HOUR);
    const minutes = totalMin % MIN_PER_HOUR;
    return minutes === 0 ? `${hours} hr left` : `${hours} hr ${minutes} min left`;
  }

  const days = Math.floor(totalMin / MIN_PER_DAY);
  const hours = Math.floor((totalMin % MIN_PER_DAY) / MIN_PER_HOUR);
  const dayPart = days === 1 ? "1 day" : `${days} days`;
  return hours === 0 ? `${dayPart} left` : `${dayPart} ${hours} hr left`;
}

/** Remaining label if `item` is an event happening at `now`. */
export function eventRemainingLabel(item: Item, now = new Date()): string | undefined {
  if (!isHappeningNow(item, now)) return undefined;
  const bounds = eventSessionBounds(item, now);
  if (!bounds) return undefined;
  return formatRemainingLabel(bounds.end.getTime() - now.getTime());
}

export function formatDaySummary(events: number, due: number, overdue: number) {
  const parts: string[] = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (events) parts.push(`${events} event${events === 1 ? "" : "s"}`);
  if (due) parts.push(`${due} due`);
  if (parts.length === 0) return "Clear day";
  return parts.join(" · ");
}
