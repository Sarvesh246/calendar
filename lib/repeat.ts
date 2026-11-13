import { addDays, addMonths, addWeeks, startOfDay } from "date-fns";
import type { RepeatRule } from "./types";

const HORIZON_MONTHS = 18;
const YEARLY_HORIZON_MONTHS = 60;
const MAX_OCCURRENCES = 400;

export function defaultUntilIso(from = new Date()): string {
  return addMonths(startOfDay(from), HORIZON_MONTHS).toISOString();
}

/** Duration in ms between start and end, or 0 when there is no end. */
export function spanMs(at: string, endAt?: string): number {
  if (!endAt) return 0;
  const span = +new Date(endAt) - +new Date(at);
  return Number.isFinite(span) && span > 0 ? span : 0;
}

/**
 * The `n`-th monthly occurrence after `start`, always anchored on the start's
 * day of the month.
 *
 * Stepping a cursor with `addMonths` compounds February's clamp: a series on
 * the 31st became Jan 31 → Feb 28 → **Mar 28** → Apr 28 and never returned to
 * the 31st. Re-deriving each occurrence from the original anchor keeps the
 * clamp local to the short month (Jan 31 → Feb 28 → Mar 31 → Apr 30).
 */
function monthlyFrom(start: Date, n: number): Date {
  const month = start.getMonth() + n;
  const lastDay = new Date(start.getFullYear(), month + 1, 0).getDate();
  const out = new Date(start.getTime());
  // Year, month and day are applied together, so an out-of-range day never
  // rolls the month over on the way through.
  out.setFullYear(start.getFullYear(), month, Math.min(start.getDate(), lastDay));
  return out;
}

/** `n` years after `start`, re-derived from the anchor so Feb 29 clamps to
 *  Feb 28 in common years and returns to Feb 29 in the next leap year. */
function yearlyFrom(start: Date, n: number): Date {
  const year = start.getFullYear() + n;
  const lastDay = new Date(year, start.getMonth() + 1, 0).getDate();
  const out = new Date(start.getTime());
  out.setFullYear(year, start.getMonth(), Math.min(start.getDate(), lastDay));
  return out;
}

/**
 * The date of the `pos`-th `weekday` (0 = Sunday) in a month, keeping `time`'s
 * clock fields. `pos` 1…4 counts from the start of the month; -1 is the last.
 * Returns null for a month that has no such day (there is no 5th Monday in
 * most months, but 1…4 and -1 always exist).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  pos: number,
  time: Date,
): Date | null {
  let day: number;
  if (pos === -1) {
    const last = new Date(year, month + 1, 0);
    day = last.getDate() - ((last.getDay() - weekday + 7) % 7);
  } else if (pos >= 1 && pos <= 4) {
    const firstDow = new Date(year, month, 1).getDay();
    day = 1 + ((weekday - firstDow + 7) % 7) + (pos - 1) * 7;
  } else {
    return null;
  }
  const out = new Date(year, month, day);
  out.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds());
  return out;
}

const ORDINALS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last",
};
const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "first Monday", "last Friday" — or null when the rule isn't an nth-weekday rule. */
export function nthWeekdayLabel(rule: RepeatRule): string | null {
  if (rule.freq !== "monthly" || !rule.bySetPos || rule.byDay?.length !== 1) return null;
  const ord = ORDINALS[rule.bySetPos];
  const day = LONG_DAYS[rule.byDay[0]];
  return ord && day ? `${ord} ${day}` : null;
}

/** The nth-weekday rule that the given date satisfies ("the 2nd Tuesday"). */
export function nthWeekdayRuleFor(date: Date): Pick<RepeatRule, "byDay" | "bySetPos"> {
  const nth = Math.floor((date.getDate() - 1) / 7) + 1;
  const isLast =
    date.getDate() + 7 > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return { byDay: [date.getDay()], bySetPos: nth === 5 || isLast ? -1 : nth };
}

export function expandRepeat(
  atIso: string,
  endAtIso: string | undefined,
  rule: RepeatRule,
): { at: string; endAt?: string }[] {
  const start = new Date(atIso);
  if (Number.isNaN(+start)) return [{ at: atIso, ...(endAtIso ? { endAt: endAtIso } : {}) }];

  const interval = Math.max(1, Math.min(30, rule.interval ?? 1));
  // A yearly series needs a longer default reach or it would only ever be two items.
  const horizon = rule.freq === "yearly" ? YEARLY_HORIZON_MONTHS : HORIZON_MONTHS;
  const until = rule.until ? new Date(rule.until) : addMonths(start, horizon);
  const cap = Number.isNaN(+until) ? addMonths(start, horizon) : until;
  const duration = spanMs(atIso, endAtIso);
  const out: { at: string; endAt?: string }[] = [];

  const push = (d: Date) => {
    if (d.getTime() > cap.getTime()) return false;
    const at = d.toISOString();
    out.push(duration ? { at, endAt: new Date(d.getTime() + duration).toISOString() } : { at });
    return out.length < MAX_OCCURRENCES;
  };

  if (rule.freq === "weekly" && rule.byDay && rule.byDay.length > 0) {
    const days = [...new Set(rule.byDay.filter((d) => d >= 0 && d <= 6))].sort((a, b) => a - b);
    if (days.length === 0) {
      push(start);
      return out;
    }
    // Walk week by week from the week of `start`.
    let weekAnchor = startOfDay(start);
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay()); // Sunday
    let week = 0;
    while (out.length < MAX_OCCURRENCES) {
      if (week % interval === 0) {
        for (const dow of days) {
          const occ = new Date(weekAnchor);
          occ.setDate(weekAnchor.getDate() + dow);
          occ.setHours(
            start.getHours(),
            start.getMinutes(),
            start.getSeconds(),
            start.getMilliseconds(),
          );
          if (occ.getTime() + 60_000 < start.getTime()) continue;
          if (!push(occ)) return out;
        }
      }
      week += 1;
      weekAnchor = addWeeks(weekAnchor, 1);
      if (weekAnchor.getTime() > cap.getTime()) break;
    }
    return out.length ? out : [{ at: atIso, ...(endAtIso ? { endAt: endAtIso } : {}) }];
  }

  // "First Monday of every month": walk months, keep the first match on or
  // after `start` (a start that isn't itself a match begins at the next one).
  if (rule.freq === "monthly" && rule.bySetPos && rule.byDay?.length === 1) {
    const dow = rule.byDay[0];
    if (dow >= 0 && dow <= 6) {
      for (let m = 0; out.length < MAX_OCCURRENCES; m += interval) {
        const occ = nthWeekdayOfMonth(
          start.getFullYear(),
          start.getMonth() + m,
          dow,
          rule.bySetPos,
          start,
        );
        if (!occ) break;
        if (occ.getTime() + 60_000 < start.getTime()) continue;
        if (!push(occ)) break;
        if (occ.getTime() > cap.getTime()) break;
      }
      if (out.length) return out;
    }
  }

  let cursor = new Date(start);
  let step = 0;
  while (push(cursor)) {
    step += 1;
    if (rule.freq === "daily") cursor = addDays(cursor, interval);
    else if (rule.freq === "weekly") cursor = addWeeks(cursor, interval);
    else if (rule.freq === "yearly") cursor = yearlyFrom(start, step * interval);
    else cursor = monthlyFrom(start, step * interval);
    if (cursor.getTime() > cap.getTime()) break;
  }
  return out.length ? out : [{ at: atIso, ...(endAtIso ? { endAt: endAtIso } : {}) }];
}

/** How many items a series would create — what a confirm card should say
 *  before anyone taps Add. */
export function countOccurrences(
  atIso: string,
  endAtIso: string | undefined,
  rule: RepeatRule,
): number {
  return expandRepeat(atIso, endAtIso, rule).length;
}

export function repeatLabel(rule: RepeatRule): string {
  const n = rule.interval ?? 1;
  if (rule.freq === "daily") return n === 1 ? "Every day" : `Every ${n} days`;
  if (rule.freq === "yearly") return n === 1 ? "Every year" : `Every ${n} years`;
  const nth = nthWeekdayLabel(rule);
  if (rule.freq === "monthly" && nth) {
    return n === 1 ? `Monthly · ${nth}` : `Every ${n} months · ${nth}`;
  }
  if (rule.freq === "monthly") return n === 1 ? "Every month" : `Every ${n} months`;
  if (rule.byDay && rule.byDay.length) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = rule.byDay
      .map((d) => names[d] ?? "")
      .filter(Boolean)
      .join("/");
    return n === 1 ? `Weekly · ${days}` : `Every ${n} weeks · ${days}`;
  }
  return n === 1 ? "Every week" : `Every ${n} weeks`;
}
