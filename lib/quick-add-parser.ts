import { addDays, nextDay, setHours, setMinutes, startOfDay, type Day } from "date-fns";
import { thisOrNextWeekday } from "./date-utils";
import { matchDatePhrase } from "./date-phrase";
import type { Category, ItemType, RepeatFreq, RepeatRule } from "./types";

export interface ParsedQuickAdd {
  title: string;
  type: ItemType;
  categoryId?: string;
  at: Date;
  endAt?: Date;
  allDay?: boolean;
  reminderMinutesBefore?: number;
  reminderLabel?: string;
  repeat?: RepeatRule;
  confidence: {
    date: boolean;
    category: boolean;
    reminder: boolean;
  };
}

export const WEEKDAYS: Record<string, Day> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const ASSIGNMENT_HINTS = [
  "due", "assignment", "hw", "homework", "reading", "lab", "essay", "project",
  "quiz", "exam", "paper", "problem set", "pset", "report", "milestone",
];

export function parseQuickAdd(
  raw: string,
  categories: Category[],
  opts?: { anchor?: Date; hour?: number; minute?: number }
): ParsedQuickAdd {
  let text = raw.trim();
  const confidence = { date: false, category: false, reminder: false };

  let categoryId: string | undefined;
  for (const cat of categories) {
    const words = cat.name.split(/\s+/).filter(Boolean);
    const acronym = words.length > 1 ? words.map((w) => w[0]).join("") : null;
    const candidates = [cat.name, ...(acronym ? [acronym] : [])];
    const match = candidates
      .map((needle) => new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i"))
      .find((re) => re.test(text));
    if (match) {
      categoryId = cat.id;
      confidence.category = true;
      text = text.replace(match, "").trim();
      break;
    }
  }

  let reminderMinutesBefore: number | undefined;
  let reminderLabel: string | undefined;
  const remindMatch = text.match(/remind me\s+(.*)$/i);
  if (remindMatch) {
    const phrase = remindMatch[1].toLowerCase();
    confidence.reminder = true;
    if (/night before/.test(phrase)) {
      reminderMinutesBefore = 12 * 60;
      reminderLabel = "Night before";
    } else if (/tomorrow/.test(phrase)) {
      reminderMinutesBefore = 24 * 60;
      reminderLabel = "Tomorrow";
    } else {
      const num = phrase.match(/(\d+)\s*(minute|min|hour|hr|day|week)/);
      if (num) {
        const n = parseInt(num[1], 10);
        const unit = num[2];
        const mult = unit.startsWith("min")
          ? 1
          : unit.startsWith("hour") || unit.startsWith("hr")
            ? 60
            : unit.startsWith("day")
              ? 1440
              : 10080;
        reminderMinutesBefore = n * mult;
        reminderLabel = `${n} ${unit}${n > 1 ? "s" : ""} before`;
      } else {
        reminderMinutesBefore = 60;
        reminderLabel = "1 hour before";
      }
    }
    text = text.replace(remindMatch[0], "").trim();
  }

  let repeat: RepeatRule | undefined;
  const everyMatch = text.match(
    /\bevery\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i
  );
  if (everyMatch) {
    const token = everyMatch[1].toLowerCase();
    if (token === "day") repeat = { freq: "daily" };
    else if (token === "week") repeat = { freq: "weekly" };
    else if (token === "month") repeat = { freq: "monthly" };
    else if (WEEKDAYS[token] !== undefined) {
      repeat = { freq: "weekly", byDay: [WEEKDAYS[token]] };
    }
    text = text.replace(everyMatch[0], "").trim();
  }

  const isAssignment = ASSIGNMENT_HINTS.some((h) => new RegExp(`\\b${h}\\b`, "i").test(text));
  const type: ItemType = isAssignment ? "assignment" : "event";

  let allDay = false;
  if (/\ball[\s-]?day\b/i.test(text)) {
    allDay = true;
    text = text.replace(/\ball[\s-]?day\b/i, "").trim();
  }

  let base = startOfDay(opts?.anchor ?? new Date());
  let hour = allDay ? 12 : isAssignment ? 23 : opts?.hour ?? 12;
  let minute = allDay ? 0 : isAssignment ? 59 : opts?.minute ?? 0;
  let matchedDate = Boolean(opts?.anchor) || opts?.hour !== undefined;
  let rangeEnd: Date | undefined;

  // An actual calendar date beats everything else, including the day the user
  // happened to have selected — writing "Sept. 9" is as explicit as it gets, and
  // it used to be ignored entirely, putting the item on today.
  const datePhrase = matchDatePhrase(text);
  if (datePhrase) {
    base = datePhrase.start;
    matchedDate = true;
    if (datePhrase.end) {
      rangeEnd = datePhrase.end;
      // A span of days is an all-day event; nobody means 12:00–12:00.
      allDay = true;
    }
    text = (text.slice(0, datePhrase.index) + text.slice(datePhrase.index + datePhrase.text.length)).trim();
  } else if (/\btomorrow\b/i.test(text)) {
    base = addDays(base, 1);
    matchedDate = true;
    text = text.replace(/\btomorrow\b/i, "").trim();
  } else if (/\byesterday\b/i.test(text)) {
    base = addDays(base, -1);
    matchedDate = true;
    text = text.replace(/\byesterday\b/i, "").trim();
  } else if (/\btoday\b/i.test(text)) {
    matchedDate = true;
    text = text.replace(/\btoday\b/i, "").trim();
  } else {
    const nextWd = text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if (nextWd) {
      const dow = WEEKDAYS[nextWd[1].toLowerCase()];
      base = nextDay(startOfDay(new Date()), dow);
      matchedDate = true;
      text = text.replace(nextWd[0], "").trim();
    } else {
      for (const [name, dow] of Object.entries(WEEKDAYS)) {
        const re = new RegExp(`\\b${name}\\b`, "i");
        if (re.test(text)) {
          base = thisOrNextWeekday(dow);
          matchedDate = true;
          text = text.replace(re, "").trim();
          break;
        }
      }
    }
  }
  confidence.date = matchedDate;

  let endAt: Date | undefined;
  const range = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (range && !allDay) {
    const endMeridiem = range[6].toLowerCase();
    const startMeridiem = (range[3] || range[6]).toLowerCase();
    hour = toHour(parseInt(range[1], 10), startMeridiem);
    minute = range[2] ? parseInt(range[2], 10) : 0;
    const endHour = toHour(parseInt(range[4], 10), endMeridiem);
    const endMinute = range[5] ? parseInt(range[5], 10) : 0;
    endAt = setMinutes(setHours(base, endHour), endMinute);
    confidence.date = true;
    text = text.replace(range[0], "").trim();
  } else if (!allDay) {
    const timeMatch = text.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)\b/i);
    if (timeMatch) {
      hour = toHour(parseInt(timeMatch[1], 10), timeMatch[4]);
      minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
      confidence.date = true;
      text = text.replace(timeMatch[0], "").trim();
    } else {
      const t24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (t24) {
        hour = parseInt(t24[1], 10);
        minute = parseInt(t24[2], 10);
        confidence.date = true;
        text = text.replace(t24[0], "").trim();
      }
    }
  }

  const at = allDay ? setMinutes(setHours(base, 12), 0) : setMinutes(setHours(base, hour), minute);
  // A day range wins over any time range picked out of the leftover text.
  if (rangeEnd) endAt = setMinutes(setHours(rangeEnd, 12), 0);

  let title = text
    .replace(/^[·•\-–—,:\s]+|[·•\-–—,:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  let prevLength: number;
  do {
    prevLength = title.length;
    title = title.replace(/\s*\b(due|at|on|by|for)\b\s*$/i, "").trim();
  } while (title.length !== prevLength && title.length > 0);

  return {
    title: title.length > 0 ? capitalize(title) : "Untitled",
    type,
    categoryId,
    at,
    ...(endAt && +endAt > +at ? { endAt } : {}),
    ...(allDay ? { allDay: true } : {}),
    reminderMinutesBefore,
    reminderLabel,
    repeat,
    confidence,
  };
}

function toHour(h: number, meridiem: string): number {
  const pm = /pm/i.test(meridiem);
  if (pm && h < 12) return h + 12;
  if (!pm && h === 12) return 0;
  return h;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseRepeatFreq(v: string): RepeatFreq | null {
  return v === "daily" || v === "weekly" || v === "monthly" ? v : null;
}
