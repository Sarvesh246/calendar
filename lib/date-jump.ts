import { addDays, addMonths, addWeeks, startOfDay } from "date-fns";
import { matchDatePhrase } from "./date-phrase";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

function validDay(y: number, m: number, d: number): Date | null {
  const date = new Date(y, m, d);
  return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d ? date : null;
}

/**
 * What someone types into "jump to date": `finals`-week style targets written
 * as plain dates ("Dec 12", "12/12", "2026-12-12"), relative hops ("in 3
 * weeks", "next month", "friday"), or a bare month ("january 2027"). Returns
 * local midnight of the day to show, or null when it isn't a date.
 */
export function parseJumpDate(text: string, now = new Date()): Date | null {
  return parseJumpTarget(text, now)?.date ?? null;
}

/** Like `parseJumpDate`, but also says whether the text named a day or a whole month. */
export function parseJumpTarget(
  text: string,
  now = new Date()
): { date: Date; granularity: "day" | "month" } | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, "");
  const monthOnly = t.match(/^([a-z]+)\.? ?(\d{4})?$/);
  if (monthOnly && MONTHS[monthOnly[1]] !== undefined) {
    const year = monthOnly[2] ? Number(monthOnly[2]) : startOfDay(now).getFullYear();
    return { date: new Date(year, MONTHS[monthOnly[1]], 1), granularity: "month" };
  }
  const date = parseDay(t, text, now);
  return date ? { date, granularity: "day" } : null;
}

function parseDay(t: string, text: string, now: Date): Date | null {
  if (!t) return null;
  const today = startOfDay(now);

  if (t === "today" || t === "now") return today;
  if (t === "tomorrow") return addDays(today, 1);
  if (t === "yesterday") return addDays(today, -1);

  const rel = t.match(/^in (\d{1,3}) (day|week|month|year)s?$/);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2] === "day") return addDays(today, n);
    if (rel[2] === "week") return addWeeks(today, n);
    if (rel[2] === "month") return addMonths(today, n);
    return addMonths(today, n * 12);
  }

  const hop = t.match(/^(next|last) (week|month|year)$/);
  if (hop) {
    const dir = hop[1] === "next" ? 1 : -1;
    if (hop[2] === "week") return addWeeks(today, dir);
    if (hop[2] === "month") return addMonths(today, dir);
    return addMonths(today, dir * 12);
  }

  const wd = t.match(/^(next |this )?([a-z]+)$/);
  if (wd && WEEKDAYS[wd[2]] !== undefined) {
    const dow = WEEKDAYS[wd[2]];
    let delta = (dow - today.getDay() + 7) % 7;
    if (wd[1] === "next " && delta === 0) delta = 7;
    return addDays(today, delta);
  }

  // Month name + day (+ year), either order: "dec 12", "12 december 2027".
  const named =
    t.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/) ??
    t.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/);
  if (named) {
    const [a, b, y] = [named[1], named[2], named[3]];
    const monthWord = /^\d/.test(a) ? b : a;
    const dayNum = Number(/^\d/.test(a) ? a : b);
    const month = MONTHS[monthWord];
    if (month !== undefined) {
      return validDay(y ? Number(y) : today.getFullYear(), month, dayNum);
    }
  }

  const numeric = t.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (numeric) {
    const y = numeric[3]
      ? numeric[3].length === 2
        ? 2000 + Number(numeric[3])
        : Number(numeric[3])
      : today.getFullYear();
    return validDay(y, Number(numeric[1]) - 1, Number(numeric[2]));
  }

  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return validDay(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const phrase = matchDatePhrase(text, now);
  if (phrase && phrase.text.trim().length >= t.length - 1) return startOfDay(phrase.start);
  return null;
}
