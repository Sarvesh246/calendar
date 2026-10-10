import { differenceInCalendarDays, format, isSameDay } from "date-fns";
import { formatTime } from "./date-utils";
import type { Item } from "./types";

export type SummaryTone = "warn" | "good" | "accent" | "neutral";

export interface ItemWhenSummary {
  /** "Friday, October 9" — empty when the stored date is unusable. */
  date: string;
  /** "11:59 PM", "All day", or "9:00 AM – 10:15 AM". */
  time: string;
  /** The one phrase that answers "do I need to care about this right now?". */
  chip: { label: string; tone: SummaryTone };
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function relativeDay(target: Date, now: Date): string {
  const diff = differenceInCalendarDays(target, now);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return format(target, "MMM d");
}

/**
 * What a detail screen leads with: when this is, in words, and a single status
 * phrase. The raw ISO strings and date inputs stay below for editing — this is
 * the part you read.
 */
export function summarizeItemWhen(item: Item, now: Date, clock24h: boolean): ItemWhenSummary {
  const at = new Date(item.at);
  if (Number.isNaN(at.getTime())) {
    return { date: "", time: "", chip: { label: "No date", tone: "neutral" } };
  }
  const isEvent = item.type === "event";
  const end = item.endAt ? new Date(item.endAt) : null;
  const time = item.allDay
    ? "All day"
    : isEvent && end && !Number.isNaN(end.getTime()) && isSameDay(at, end)
      ? `${formatTime(item.at, clock24h)} – ${formatTime(item.endAt!, clock24h)}`
      : formatTime(item.at, clock24h);
  const date = format(at, "EEEE, MMMM d");
  const days = differenceInCalendarDays(at, now);

  if (!isEvent && item.status === "done") {
    const doneAt = item.completedAt ? new Date(item.completedAt) : null;
    const label =
      doneAt && !Number.isNaN(doneAt.getTime()) ? `Done ${relativeDay(doneAt, now)}` : "Done";
    return { date, time, chip: { label, tone: "good" } };
  }

  if (isEvent) {
    const over = (end && !Number.isNaN(end.getTime()) ? end : at).getTime() < now.getTime();
    if (over) return { date, time, chip: { label: "Ended", tone: "neutral" } };
    if (days === 0) return { date, time, chip: { label: "Today", tone: "accent" } };
    if (days === 1) return { date, time, chip: { label: "Tomorrow", tone: "neutral" } };
    return { date, time, chip: { label: `In ${plural(days, "day")}`, tone: "neutral" } };
  }

  const overdue = item.allDay ? days < 0 : at.getTime() < now.getTime();
  if (overdue) {
    const late = Math.abs(days);
    return {
      date,
      time,
      chip: { label: late === 0 ? "Overdue" : `${plural(late, "day")} overdue`, tone: "warn" },
    };
  }
  if (days === 0) return { date, time, chip: { label: "Due today", tone: "accent" } };
  if (days === 1) return { date, time, chip: { label: "Due tomorrow", tone: "neutral" } };
  return { date, time, chip: { label: `Due in ${plural(days, "day")}`, tone: "neutral" } };
}
