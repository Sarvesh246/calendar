import { addDays, getDay, setHours, setMinutes, startOfDay } from "date-fns";
import { matchDatePhrase } from "./date-phrase";
import { defaultUntilIso } from "./repeat";
import type { Category, Item, RepeatRule } from "./types";

const WEEKDAY_NAME: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const COMPACT: { re: RegExp; days: number[] }[] = [
  { re: /\bmtwrf\b|\bweekdays\b/i, days: [1, 2, 3, 4, 5] },
  { re: /\bmwf\b/i, days: [1, 3, 5] },
  { re: /\btth\b|\bt\/th\b|\btr\b/i, days: [2, 4] },
  { re: /\bmw\b/i, days: [1, 3] },
  { re: /\bwf\b/i, days: [3, 5] },
];

export function weekdayShort(d: number): string {
  return DAY_NAMES[d] ?? "";
}

export function weekdayLong(d: number): string {
  return (
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d] ?? ""
  );
}

export function clockInput(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Pull MWF / TTh / Mon, Wed, Fri out of free text. */
export function extractScheduleDays(
  text: string,
  opts?: { minDays?: number }
): { days: number[]; rest: string } | null {
  const minDays = opts?.minDays ?? 2;
  const compact = COMPACT.find((c) => c.re.test(text));
  if (compact) {
    return { days: compact.days, rest: text.replace(compact.re, " ").replace(/\s+/g, " ").trim() };
  }

  const found: number[] = [];
  let rest = text;
  const long =
    /\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = long.exec(text))) {
    const key = m[1].toLowerCase();
    const full =
      key.startsWith("sun")
        ? "sunday"
        : key.startsWith("mon")
          ? "monday"
          : key.startsWith("tue")
            ? "tuesday"
            : key.startsWith("wed")
              ? "wednesday"
              : key.startsWith("thu")
                ? "thursday"
                : key.startsWith("fri")
                  ? "friday"
                  : "saturday";
    const dow = WEEKDAY_NAME[full];
    if (dow !== undefined && !found.includes(dow)) found.push(dow);
    rest = rest.replace(m[0], " ");
  }
  // Registrar shorthand for a single day — the "W" in "MWF 9–9:50 W 2–4:50".
  // Uppercase and standalone only, so ordinary words are never read as days.
  if (found.length === 0) {
    const single: Record<string, number> = { M: 1, T: 2, W: 3, R: 4, F: 5 };
    const letter = /(?:^|\s)([MTWRF])(?=\s|$)/g;
    while ((m = letter.exec(text))) {
      const dow = single[m[1]];
      if (!found.includes(dow)) found.push(dow);
      rest = rest.replace(new RegExp(`(^|\\s)${m[1]}(?=\\s|$)`), " ");
    }
  }
  if (found.length < minDays) return null;
  return { days: found.sort((a, b) => a - b), rest: rest.replace(/\s+/g, " ").trim() };
}

export function extractUntilIso(text: string, from = new Date()): { until: string; rest: string } | null {
  const untilMatch = text.match(/\b(?:until|through|thru|to)\s+(.+)$/i);
  if (!untilMatch) return null;
  const phrase = matchDatePhrase(untilMatch[1], from);
  if (!phrase) return null;
  const end = startOfDay(phrase.end ?? phrase.start);
  end.setHours(23, 59, 59, 0);
  const before = text.slice(0, untilMatch.index).trim();
  return { until: end.toISOString(), rest: before };
}

const TIME_RANGE_SOURCE =
  String.raw`\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b`;

export interface ClassMeeting {
  days: number[];
  hour: number;
  minute: number;
  endHour: number;
  endMinute: number;
}

export interface ParsedClassSchedule {
  title: string;
  categoryId?: string;
  days: number[];
  hour: number;
  minute: number;
  endHour: number;
  endMinute: number;
  location?: string;
  until: string;
  meetings: ClassMeeting[];
}

/**
 * A side keeps the am/pm it states. An unstated one takes whichever reading
 * gives the shortest positive span, so "11–12:15" crosses noon and
 * "12:30–1:45" is an afternoon class. A range with no am/pm at all starts on
 * class hours (1–6 and 12 are afternoon, 7–11 morning). Copying one side's
 * meridiem onto the other used to read "11–12:15" as ending at 12:15 AM.
 */
function parseTimeRange(range: RegExpExecArray): Omit<ClassMeeting, "days"> | null {
  const startH = parseInt(range[1], 10);
  const minute = range[2] ? parseInt(range[2], 10) : 0;
  const endH = parseInt(range[4], 10);
  const endMinute = range[5] ? parseInt(range[5], 10) : 0;
  const startMer = range[3]?.toLowerCase();
  const endMer = range[6]?.toLowerCase();

  const readings = (h: number, mer?: string) =>
    mer ? [toHour(h, mer)] : h > 12 ? [h] : [toHour(h, "am"), toHour(h, "pm")];
  const starts = startMer
    ? [toHour(startH, startMer)]
    : endMer
      ? readings(startH)
      : [classHour(startH)];

  let best: { hour: number; endHour: number; span: number } | null = null;
  for (const hour of starts) {
    for (const endHour of readings(endH, endMer)) {
      const span = endHour * 60 + endMinute - (hour * 60 + minute);
      if (span > 0 && (!best || span < best.span)) best = { hour, endHour, span };
    }
  }
  if (!best) return null;
  return { hour: best.hour, minute, endHour: best.endHour, endMinute };
}

/** A bare start hour on a class schedule: 1–6 and noon are afternoon. */
function classHour(h: number): number {
  if (h >= 12) return h;
  return h >= 1 && h <= 6 ? h + 12 : h;
}

function stripDayTokens(text: string): string {
  let rest = text;
  let hit = extractScheduleDays(rest, { minDays: 1 });
  while (hit) {
    rest = hit.rest;
    hit = extractScheduleDays(rest, { minDays: 1 });
  }
  return rest.replace(/\s+/g, " ").trim();
}

/**
 * Pair each time range with the days next to it.
 * "MW 4:15-5:00 TTh 5:30-6:45" and "Tuesdays and Thursdays 5:30-6:45,
 * Mondays and Wednesdays 4:15-5:00" both become two meetings.
 */
export function extractScheduleMeetings(text: string): {
  meetings: ClassMeeting[];
  rest: string;
} | null {
  const ranges: { start: number; end: number; match: RegExpExecArray }[] = [];
  const re = new RegExp(TIME_RANGE_SOURCE, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    ranges.push({ start: m.index, end: m.index + m[0].length, match: m });
  }
  if (ranges.length === 0) return null;

  const segment = (i: number) => {
    const start = i === 0 ? 0 : ranges[i - 1].end;
    const end = i < ranges.length ? ranges[i].start : text.length;
    return text.slice(start, end);
  };

  const meetings: ClassMeeting[] = [];
  const usedAfter = new Set<number>();
  for (let i = 0; i < ranges.length; i++) {
    const times = parseTimeRange(ranges[i].match);
    if (!times) continue;
    let daysHit = usedAfter.has(i) ? null : extractScheduleDays(segment(i), { minDays: 1 });
    if (!daysHit) {
      daysHit = extractScheduleDays(segment(i + 1), { minDays: 1 });
      if (daysHit) usedAfter.add(i + 1);
    }
    if (!daysHit) continue;
    meetings.push({ days: daysHit.days, ...times });
  }
  if (meetings.length === 0) return null;

  let rest = text;
  for (let i = ranges.length - 1; i >= 0; i--) {
    rest = `${rest.slice(0, ranges[i].start)} ${rest.slice(ranges[i].end)}`;
  }
  return { meetings, rest: stripDayTokens(rest) };
}

export function firstSharedDay(meetings: { days: number[] }[]): number | null {
  const seen = new Set<number>();
  for (const meeting of meetings) {
    for (const day of meeting.days) {
      if (seen.has(day)) return day;
      seen.add(day);
    }
  }
  return null;
}

/**
 * First weekday on which two meetings' times overlap, or null. Two separate
 * times on one day — a morning lecture and an afternoon lab — are fine.
 */
export function firstOverlappingDay(meetings: ClassMeeting[]): number | null {
  for (let i = 0; i < meetings.length; i++) {
    for (let j = i + 1; j < meetings.length; j++) {
      const a = meetings[i];
      const b = meetings[j];
      const overlap =
        a.hour * 60 + a.minute < b.endHour * 60 + b.endMinute &&
        b.hour * 60 + b.minute < a.endHour * 60 + a.endMinute;
      if (!overlap) continue;
      const day = a.days.find((d) => b.days.includes(d));
      if (day !== undefined) return day;
    }
  }
  return null;
}

/**
 * Parse a class-times line: "ENGL 101 MWF 10:00-10:50 Room 204 until Dec 12".
 * Split times ("MW 4:15-5:00 TTh 5:30-6:45") become multiple meetings.
 * Returns null when there aren't enough days or a time range.
 */
export function parseClassSchedule(
  raw: string,
  categories: Category[],
  from = new Date()
): ParsedClassSchedule | null {
  let text = raw.trim();
  if (!text) return null;

  let categoryId: string | undefined;
  for (const cat of categories) {
    const name = cat.name?.trim();
    if (!name) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      categoryId = cat.id;
      text = text.replace(re, " ").trim();
      break;
    }
    const code = name.match(/^([A-Za-z]{2,5})[\s-]?(\d{2,4})/);
    if (code && new RegExp(`\\b${code[1]}[\\s-]?${code[2]}\\b`, "i").test(text)) {
      categoryId = cat.id;
      text = text.replace(new RegExp(`\\b${code[1]}[\\s-]?${code[2]}\\b`, "i"), " ").trim();
      break;
    }
  }

  let until = defaultUntilIso(from);
  const untilHit = extractUntilIso(text, from);
  if (untilHit) {
    until = untilHit.until;
    text = untilHit.rest;
  }

  const grouped = extractScheduleMeetings(text);
  if (!grouped) return null;
  const meetings = grouped.meetings;
  text = grouped.rest;

  const loc = text.match(/\b(?:room|rm\.?|bldg\.?|building)\s+([A-Za-z0-9\- ]{1,24})/i);
  let location: string | undefined;
  if (loc) {
    location = loc[0].replace(/\s+/g, " ").trim();
    text = text.replace(loc[0], " ").trim();
  }

  let title = text
    .replace(/\b(?:and|&)\b/gi, " ")
    .replace(/^[·•\-–—,:\s]+|[·•\-–—,:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!title) {
    const cat = categories.find((c) => c.id === categoryId);
    title = cat?.name?.trim() || "Class";
  }

  const first = meetings[0];
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    categoryId,
    days: first.days,
    hour: first.hour,
    minute: first.minute,
    endHour: first.endHour,
    endMinute: first.endMinute,
    location,
    until,
    meetings,
  };
}

export function looksLikeClassSchedule(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (extractScheduleDays(t)) return true;
  return /\bmwf\b|\btth\b|\bclass times?\b|\blecture\b/i.test(t);
}

export function scheduleRepeat(days: number[], until?: string): RepeatRule {
  const unique = [...new Set(days.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
  return {
    freq: "weekly",
    byDay: unique.length ? unique : [new Date().getDay()],
    until: until ?? defaultUntilIso(),
  };
}

/** `HH:MM` or `HH:MM:SS` from a time input. */
export function parseClockInput(value: string): { hour: number; minute: number } | null {
  const m = value.trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour > 23) return null;
  return { hour, minute: Number(m[2]) };
}

/** First selected weekday on or after `from` (today counts). */
export function soonestOnDays(days: number[], from = new Date()): Date {
  const want = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  const start = startOfDay(from);
  if (want.size === 0) return start;
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (want.has(getDay(d))) return d;
  }
  return start;
}

export function untilDayToIso(day: string, fallback = defaultUntilIso()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fallback;
  const d = new Date(`${day}T23:59:59`);
  return Number.isNaN(+d) ? fallback : d.toISOString();
}

export function meetingDateTimes(
  meeting: ClassMeeting,
  from = new Date()
): { at: Date; endAt: Date } | null {
  if (meeting.days.length === 0) return null;
  const first = soonestOnDays(meeting.days, from);
  const at = setMinutes(setHours(new Date(first), meeting.hour), meeting.minute);
  const endAt = setMinutes(setHours(new Date(first), meeting.endHour), meeting.endMinute);
  if (Number.isNaN(+at) || Number.isNaN(+endAt) || +endAt <= +at) return null;
  return { at, endAt };
}

export interface SavedClassMeeting {
  repeatId: string;
  ids: string[];
  days: number[];
  hour: number;
  minute: number;
  endHour?: number;
  endMinute?: number;
  title: string;
  count: number;
}

export function formatClock(hour: number, minute: number, clock24h = false): string {
  if (clock24h) return clockInput(hour, minute);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mer = hour >= 12 ? "PM" : "AM";
  return `${h12}:${String(minute).padStart(2, "0")} ${mer}`;
}

export function formatTimeRange(
  startHour: number,
  startMinute: number,
  endHour: number | undefined,
  endMinute: number | undefined,
  clock24h = false
): string {
  const start = formatClock(startHour, startMinute, clock24h);
  if (endHour == null || endMinute == null) return start;
  const end = formatClock(endHour, endMinute, clock24h);
  if (clock24h || startHour >= 12 === endHour >= 12) {
    return `${start.replace(/\s?(AM|PM)$/i, "")}–${end}`;
  }
  return `${start}–${end}`;
}

export function formatMeetingSummary(meeting: SavedClassMeeting, clock24h = false): string {
  const days = meeting.days.map((d) => weekdayShort(d)).filter(Boolean).join("/");
  const range = formatTimeRange(
    meeting.hour,
    meeting.minute,
    meeting.endHour,
    meeting.endMinute,
    clock24h
  );
  return days ? `${days} ${range}` : range;
}

/** User-created weekly lecture/lab from the class-times sheet — not a feed event. */
export function isClassScheduleItem(item: Item): boolean {
  if (item.type !== "event" || item.allDay || item.sourceId) return false;
  return item.repeat?.freq === "weekly" && Boolean(item.repeat.byDay?.length);
}

const GENERIC_CATEGORY =
  /^(personal|work|home|family|life|imported|uncategorized|general|misc|miscellaneous)$/i;
const COURSE_CODE = /^[A-Za-z]{2,5}[\s-]?\d{2,4}\b/;
const CLASS_TITLE = /\b(lecture|seminar|recitation|lab|discussion|class)\b/i;
const MIN_CLASS_MS = 15 * 60_000;
const MAX_CLASS_MS = 3 * 60 * 60_000;

export function isGenericCategoryName(name?: string): boolean {
  const n = name?.trim() ?? "";
  return !n || GENERIC_CATEGORY.test(n);
}

function sessionMs(item: Item): number {
  if (!item.endAt) return 0;
  const start = new Date(item.at).getTime();
  const end = new Date(item.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return end - start;
}

/**
 * Live class/lecture vs a one-off (career fair, appointment).
 * User-created weekly meetings, weekly events on a course category, or a
 * course-coded / lecture-titled session of class length.
 */
export function isClassMeeting(item: Item, categoryName?: string): boolean {
  if (item.type !== "event" || item.allDay) return false;
  if (isClassScheduleItem(item)) return true;
  if (isGenericCategoryName(categoryName)) return false;
  if (item.repeat?.freq === "weekly") return true;
  const dur = sessionMs(item);
  const classLen = dur >= MIN_CLASS_MS && dur <= MAX_CLASS_MS;
  if (!classLen) return false;
  const cat = categoryName?.trim() ?? "";
  if (COURSE_CODE.test(cat)) return true;
  return CLASS_TITLE.test(item.title);
}

/** User-created weekly class meetings for a category, grouped by series. */
export function savedClassMeetings(items: Item[], categoryId: string): SavedClassMeeting[] {
  const series = new Map<string, Item[]>();
  for (const item of items) {
    if (item.categoryId !== categoryId || item.type !== "event" || item.sourceId) continue;
    if (item.repeat?.freq !== "weekly" || !item.repeat.byDay?.length) continue;
    const key = item.repeatId ?? item.id;
    const list = series.get(key);
    if (list) list.push(item);
    else series.set(key, [item]);
  }

  const meetings: SavedClassMeeting[] = [];
  for (const [repeatId, occs] of series) {
    const first = occs.slice().sort((a, b) => +new Date(a.at) - +new Date(b.at))[0];
    const at = new Date(first.at);
    if (Number.isNaN(+at)) continue;
    const end = first.endAt ? new Date(first.endAt) : null;
    const days = [...new Set(first.repeat!.byDay!.filter((d) => d >= 0 && d <= 6))].sort(
      (a, b) => a - b
    );
    const meeting: SavedClassMeeting = {
      repeatId,
      ids: occs.map((item) => item.id),
      days,
      hour: at.getHours(),
      minute: at.getMinutes(),
      title: first.title,
      count: occs.length,
    };
    if (end && !Number.isNaN(+end) && +end > +at) {
      meeting.endHour = end.getHours();
      meeting.endMinute = end.getMinutes();
    }
    meetings.push(meeting);
  }

  return meetings.sort(
    (a, b) => (a.days[0] ?? 0) - (b.days[0] ?? 0) || a.hour * 60 + a.minute - (b.hour * 60 + b.minute)
  );
}

function toHour(h: number, meridiem: string): number {
  const pm = /pm/i.test(meridiem);
  const am = /am/i.test(meridiem);
  if (pm && h < 12) return h + 12;
  if (am && h === 12) return 0;
  return h;
}
