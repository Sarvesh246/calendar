import { addDays, addMonths, addWeeks, startOfDay } from "date-fns";
import type { RepeatRule } from "./types";

const HORIZON_MONTHS = 18;
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

export function expandRepeat(
  atIso: string,
  endAtIso: string | undefined,
  rule: RepeatRule
): { at: string; endAt?: string }[] {
  const start = new Date(atIso);
  if (Number.isNaN(+start)) return [{ at: atIso, ...(endAtIso ? { endAt: endAtIso } : {}) }];

  const interval = Math.max(1, Math.min(30, rule.interval ?? 1));
  const until = rule.until ? new Date(rule.until) : addMonths(start, HORIZON_MONTHS);
  const cap = Number.isNaN(+until) ? addMonths(start, HORIZON_MONTHS) : until;
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
          occ.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
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

  let cursor = new Date(start);
  while (push(cursor)) {
    if (rule.freq === "daily") cursor = addDays(cursor, interval);
    else if (rule.freq === "weekly") cursor = addWeeks(cursor, interval);
    else cursor = addMonths(cursor, interval);
    if (cursor.getTime() > cap.getTime()) break;
  }
  return out.length ? out : [{ at: atIso, ...(endAtIso ? { endAt: endAtIso } : {}) }];
}

export function repeatLabel(rule: RepeatRule): string {
  const n = rule.interval ?? 1;
  if (rule.freq === "daily") return n === 1 ? "Every day" : `Every ${n} days`;
  if (rule.freq === "monthly") return n === 1 ? "Every month" : `Every ${n} months`;
  if (rule.byDay && rule.byDay.length) {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const days = rule.byDay.map((d) => names[d] ?? "").filter(Boolean).join("/");
    return n === 1 ? `Weekly · ${days}` : `Every ${n} weeks · ${days}`;
  }
  return n === 1 ? "Every week" : `Every ${n} weeks`;
}
