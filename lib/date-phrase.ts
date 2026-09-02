import { startOfDay } from "date-fns";

/**
 * Explicit calendar dates in free text — "Sept. 9", "Sep 9-10", "3/14",
 * "2026-09-15", "March 3, 2027".
 *
 * Quick-add previously understood only relative words ("tomorrow", "friday"),
 * so anything with a real date on it silently landed on today — the one case
 * where the user had been most explicit about when they meant.
 */

export interface DatePhrase {
  /** Local midnight of the first day. */
  start: Date;
  /** Local midnight of the last day, when the text gave a range. */
  end?: Date;
  /** The exact substring matched, so the caller can strip it from a title. */
  text: string;
  /** Index of the match within the input. */
  index: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_ALTERNATION = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** "Sept. 9", "Sep 9-10", "March 3, 2027", "Sept 9 - Oct 2" */
const MONTH_FIRST = new RegExp(
  String.raw`\b(${MONTH_ALTERNATION})\.?\s+(\d{1,2})(?:\s*(?:-|–|—|to|through|thru)\s*(?:(${MONTH_ALTERNATION})\.?\s+)?(\d{1,2}))?(?:\s*,?\s*(\d{4}))?\b`,
  "i"
);

/** "9 September", "9-10 Sept" */
const DAY_FIRST = new RegExp(
  String.raw`\b(\d{1,2})(?:\s*(?:-|–|—|to)\s*(\d{1,2}))?\s+(${MONTH_ALTERNATION})\.?(?:\s*,?\s*(\d{4}))?\b`,
  "i"
);

/** ISO: 2026-09-15 */
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;

/** Numeric: 9/15, 09/15/2026, 9-15-2026 (month first — US convention) */
const NUMERIC = /(?<![\d/-])(\d{1,2})[/](\d{1,2})(?:[/](\d{2,4}))?(?![\d/])/;

/** Months either side of "now" that an unqualified date is read as the past. */
const PAST_TOLERANCE_MONTHS = 4;

/**
 * A date written without a year means the nearest sensible one: "Sept 9" typed
 * in November is next year's, but typed in October is still this year's (a
 * deadline that just passed is a real thing to record).
 */
function resolveYear(month: number, day: number, now: Date): number {
  const year = now.getFullYear();
  const candidate = new Date(year, month, day);
  const monthsAway = (candidate.getTime() - now.getTime()) / (30.44 * 24 * 3600 * 1000);
  if (monthsAway < -PAST_TOLERANCE_MONTHS) return year + 1;
  if (monthsAway > 12 - PAST_TOLERANCE_MONTHS) return year - 1;
  return year;
}

function makeDay(year: number, month: number, day: number): Date | null {
  const d = new Date(year, month, day);
  // Rejects "Feb 31" — JS would roll it into March.
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return startOfDay(d);
}

function fullYear(raw: string | undefined, month: number, day: number, now: Date): number {
  if (!raw) return resolveYear(month, day, now);
  const n = parseInt(raw, 10);
  if (raw.length <= 2) return n + (n < 70 ? 2000 : 1900);
  return n;
}

/** Find the first explicit date (or date range) in `text`, if any. */
export function matchDatePhrase(text: string, now = new Date()): DatePhrase | null {
  const iso = ISO.exec(text);
  if (iso) {
    const start = makeDay(+iso[1], +iso[2] - 1, +iso[3]);
    if (start) return { start, text: iso[0], index: iso.index };
  }

  const mf = MONTH_FIRST.exec(text);
  if (mf) {
    const month = MONTHS[mf[1].toLowerCase()];
    const day = parseInt(mf[2], 10);
    const year = fullYear(mf[5], month, day, now);
    const start = makeDay(year, month, day);
    if (start) {
      let end: Date | undefined;
      if (mf[4]) {
        const endMonth = mf[3] ? MONTHS[mf[3].toLowerCase()] : month;
        const endDay = parseInt(mf[4], 10);
        // "Dec 30 - Jan 2" crosses into the next year.
        const endYear = endMonth < month ? year + 1 : year;
        const candidate = makeDay(endYear, endMonth, endDay);
        if (candidate && candidate > start) end = candidate;
      }
      return { start, ...(end ? { end } : {}), text: mf[0], index: mf.index };
    }
  }

  const df = DAY_FIRST.exec(text);
  if (df) {
    const month = MONTHS[df[3].toLowerCase()];
    const day = parseInt(df[1], 10);
    const year = fullYear(df[4], month, day, now);
    const start = makeDay(year, month, day);
    if (start) {
      let end: Date | undefined;
      if (df[2]) {
        const candidate = makeDay(year, month, parseInt(df[2], 10));
        if (candidate && candidate > start) end = candidate;
      }
      return { start, ...(end ? { end } : {}), text: df[0], index: df.index };
    }
  }

  const num = NUMERIC.exec(text);
  if (num) {
    const month = parseInt(num[1], 10) - 1;
    const day = parseInt(num[2], 10);
    if (month >= 0 && month <= 11) {
      const year = fullYear(num[3], month, day, now);
      const start = makeDay(year, month, day);
      if (start) return { start, text: num[0], index: num.index };
    }
  }

  return null;
}
