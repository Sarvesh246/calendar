import { addDays, isBefore, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { dayKey, isOverdueAt } from "./date-utils";
import { isClassMeeting } from "./class-schedule";
import type { Category, Item } from "./types";

/**
 * One day of the Agenda's week overview, counted from the items actually on
 * it. Each number means one thing, so the strip never has to invent a scale:
 * open work still due, work already overdue, work finished, and scheduled
 * time (class meetings separately from other events).
 */
export interface WeekDaySummary {
  date: Date;
  key: string;
  isToday: boolean;
  isPast: boolean;
  due: number;
  overdue: number;
  done: number;
  classes: number;
  events: number;
}

export function summarizeWeek(
  byDay: Map<string, Item[]>,
  now: Date,
  weekStartsOn: 0 | 1,
  categoryName: (id: string) => string | undefined,
): WeekDaySummary[] {
  const today = startOfDay(now);
  const start = startOfWeek(today, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const key = dayKey(date);
    const day: WeekDaySummary = {
      date,
      key,
      isToday: isSameDay(date, today),
      isPast: isBefore(date, today),
      due: 0,
      overdue: 0,
      done: 0,
      classes: 0,
      events: 0,
    };
    for (const item of byDay.get(key) ?? []) {
      if (item.type === "event") {
        if (isClassMeeting(item, categoryName(item.categoryId))) day.classes++;
        else day.events++;
      } else if (item.status === "done") day.done++;
      else if (isOverdueAt(item, now)) day.overdue++;
      else day.due++;
    }
    return day;
  });
}

export function scheduledLabel(classes: number, events: number): string | null {
  const total = classes + events;
  if (total === 0) return null;
  if (events === 0) return `${classes} ${classes === 1 ? "class" : "classes"}`;
  return `${total} ${total === 1 ? "event" : "events"}`;
}

/** A spoken summary for a day button and its tooltip. */
export function describeWeekDay(day: WeekDaySummary): string {
  const parts: string[] = [];
  if (day.overdue) parts.push(`${day.overdue} overdue`);
  if (day.due) parts.push(`${day.due} due`);
  if (day.done) parts.push(`${day.done} done`);
  if (day.classes) parts.push(`${day.classes} ${day.classes === 1 ? "class" : "classes"}`);
  if (day.events) parts.push(`${day.events} ${day.events === 1 ? "event" : "events"}`);
  return parts.length ? parts.join(", ") : "Nothing scheduled";
}

export function categoryNameLookup(categories: Category[]) {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return (id: string) => names.get(id);
}
