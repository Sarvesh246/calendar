/**
 * Weekday and date facts the model should copy, never compute.
 *
 * The audit's model runs named the wrong weekday three times in sixteen
 * ("Advisor meeting on Wednesday" for a Thursday, "Thursday, November 13" for
 * the 12th) because the snapshot gave `2026-11-12 15:00` and left the calendar
 * arithmetic to the model. Everything here is deterministic: put the weekday on
 * every line, hand over a lookup table for the next fortnight, and after the
 * fact repair any "Weekday, Month D" the model still got wrong.
 */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** The wall-clock reading of an instant in a time zone, or null if unusable. */
function zonedParts(iso: string | Date, timeZone: string): Parts | null {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(+date)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const out = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour") % 24,
      minute: get("minute"),
    };
    return Object.values(out).every(Number.isFinite) ? out : null;
  } catch {
    return null;
  }
}

/** The weekday of a calendar date. A date has one weekday in every time zone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `Thu 2026-11-12 15:00` — the stamp every snapshot line starts with. */
export function weekdayStamp(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = zonedParts(iso, timeZone);
  if (!p) return Number.isNaN(+new Date(iso)) ? "" : iso.slice(0, 16).replace("T", " ");
  return `${SHORT[weekdayOf(p.year, p.month, p.day)]} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * `Tue Nov 10 (today), Wed Nov 11 (tomorrow), Thu Nov 12, …` — a lookup table
 * so "this Thursday" and "next Friday" are a copy, not a calculation.
 */
export function dateLookupLine(nowIso: string, timeZone: string, days = 14): string {
  const p = zonedParts(nowIso, timeZone);
  if (!p) return "";
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const label = `${SHORT[d.getUTCDay()]} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`;
    out.push(i === 0 ? `${label} (today)` : i === 1 ? `${label} (tomorrow)` : label);
  }
  return out.join(", ");
}

const DAY_RE =
  "(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:r(?:s(?:day)?)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)";
const MONTH_RE =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
// "Thursday, November 13", "Thu Nov 13", "Thursday the 13th" is left alone.
const PAIR = new RegExp(
  `\\b(${DAY_RE})(\\.?,?\\s+)(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
  "gi",
);

function monthIndex(word: string): number {
  const key = word.slice(0, 3).toLowerCase();
  return MONTH_SHORT.findIndex((m) => m.toLowerCase() === key);
}

/**
 * Repair "Weekday, Month D" pairs that disagree with the calendar. The year is
 * whichever of last, this and next year puts the date nearest to today. Text
 * with no such pair — most answers — is returned untouched.
 */
export function fixWeekdays(text: string, nowIso: string, timeZone: string): string {
  const today = zonedParts(nowIso, timeZone);
  if (!today) return text;
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return text.replace(
    PAIR,
    (whole, weekday: string, glue: string, month: string, dayText: string) => {
      const m = monthIndex(month);
      const day = Number(dayText);
      if (m < 0 || day < 1 || day > 31) return whole;
      const year = [today.year - 1, today.year, today.year + 1].reduce((best, y) =>
        Math.abs(Date.UTC(y, m, day) - todayUtc) < Math.abs(Date.UTC(best, m, day) - todayUtc)
          ? y
          : best,
      );
      const real = weekdayOf(year, m + 1, day);
      const said = SHORT.findIndex((s) => weekday.slice(0, 3).toLowerCase() === s.toLowerCase());
      if (said < 0 || said === real) return whole;
      // Keep the writer's style: a full name stays full, an abbreviation short.
      const full = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(weekday);
      const fixed = full ? LONG[real] : SHORT[real];
      return `${fixed}${glue}${month}${whole.slice(weekday.length + glue.length + month.length)}`;
    },
  );
}
