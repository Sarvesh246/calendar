import { startOfDay } from "date-fns";
import { matchDatePhrase } from "./date-phrase";
import { defaultUntilIso } from "./repeat";
import type { Category, RepeatRule } from "./types";

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

/** Pull MWF / TTh / Mon, Wed, Fri out of free text. */
export function extractScheduleDays(text: string): { days: number[]; rest: string } | null {
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
  if (found.length < 2) return null;
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
}

/**
 * Parse a class-times line: "ENGL 101 MWF 10:00-10:50 Room 204 until Dec 12".
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

  const daysHit = extractScheduleDays(text);
  let days: number[] = [];
  if (daysHit) {
    days = daysHit.days;
    text = daysHit.rest;
  }

  const range = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (!range) return days.length >= 2 ? null : null;
  text = text.replace(range[0], " ").trim();

  const endMer = (range[6] || range[3] || "am").toLowerCase();
  const startMer = (range[3] || range[6] || "am").toLowerCase();
  const hour = toHour(parseInt(range[1], 10), startMer);
  const minute = range[2] ? parseInt(range[2], 10) : 0;
  const endHour = toHour(parseInt(range[4], 10), endMer);
  const endMinute = range[5] ? parseInt(range[5], 10) : 0;

  const loc = text.match(/\b(?:room|rm\.?|bldg\.?|building)\s+([A-Za-z0-9\- ]{1,24})/i);
  let location: string | undefined;
  if (loc) {
    location = loc[0].replace(/\s+/g, " ").trim();
    text = text.replace(loc[0], " ").trim();
  }

  let title = text
    .replace(/^[·•\-–—,:\s]+|[·•\-–—,:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!title) {
    const cat = categories.find((c) => c.id === categoryId);
    title = cat?.name?.trim() || "Class";
  }

  if (days.length === 0) return null;
  if (endHour * 60 + endMinute <= hour * 60 + minute) return null;

  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    categoryId,
    days,
    hour,
    minute,
    endHour,
    endMinute,
    location,
    until,
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

function toHour(h: number, meridiem: string): number {
  const pm = /pm/i.test(meridiem);
  const am = /am/i.test(meridiem);
  if (pm && h < 12) return h + 12;
  if (am && h === 12) return 0;
  return h;
}
