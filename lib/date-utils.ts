import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isTomorrow,
  isYesterday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import type { Item } from "./types";

export function formatTime(iso: string, clock24h: boolean) {
  return format(new Date(iso), clock24h ? "HH:mm" : "h:mm a");
}

export function monthGrid(anchor: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn });
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn });
  return eachDayOfInterval({ start, end }).map((date) => ({
    date,
    inMonth: isSameMonth(date, anchor),
  }));
}

export function weekDays(anchor: Date, weekStartsOn: 0 | 1) {
  const start = startOfWeek(anchor, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function itemsOnDay(items: Item[], day: Date) {
  return items
    .filter((i) => isSameDay(new Date(i.at), day))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMMM d");
}

export function relativeDueLabel(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Due today";
  if (isTomorrow(date)) return "Due tomorrow";
  if (isYesterday(date)) return "Overdue — was due yesterday";
  if (date.getTime() < Date.now()) return `Overdue — was due ${format(date, "MMM d")}`;
  return `Due ${format(date, "EEE, MMM d")}`;
}

export function isOverdue(item: Item) {
  if (item.type === "event" || item.status === "done") return false;
  return new Date(item.at).getTime() < Date.now() && !isToday(new Date(item.at));
}

export function timeOfDayGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return { label: "Late night", sub: "Still up?" };
  if (hour < 12) return { label: "Good morning", sub: "Here's your day." };
  if (hour < 17) return { label: "Your afternoon", sub: "Here's what's left." };
  if (hour < 21) return { label: "Your evening", sub: "Winding down." };
  return { label: "Wrapping up", sub: "Here's tomorrow, at a glance." };
}

export function workloadIntensity(count: number) {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  return 4;
}
