import { addDays, addHours, setHours, setMinutes, startOfDay } from "date-fns";
import type { Category, Item, ReminderPreset } from "./types";

const today = startOfDay(new Date());

function at(dayOffset: number, hour: number, minute = 0) {
  return setMinutes(setHours(addDays(today, dayOffset), hour), minute).toISOString();
}

export const defaultCategories: Category[] = [
  { id: "cat-cs", name: "Computer Science", color: "#7C6CFF" },
  { id: "cat-bio", name: "Biology", color: "#E8A23D" },
  { id: "cat-personal", name: "Personal", color: "#3DBE8B" },
  { id: "cat-club", name: "Club", color: "#4C9BE8" },
];

export const defaultReminderPresets: ReminderPreset[] = [
  { id: "rp-15m", label: "15 minutes before", offsetMinutes: 15 },
  { id: "rp-1h", label: "1 hour before", offsetMinutes: 60 },
  { id: "rp-night", label: "Night before (9pm)", offsetMinutes: 12 * 60 },
  { id: "rp-week", label: "1 week before", offsetMinutes: 7 * 24 * 60 },
];

export const defaultItems: Item[] = [
  {
    id: "item-1",
    categoryId: "cat-cs",
    type: "event",
    title: "Lecture — Systems Programming",
    location: "Warren Hall 205",
    at: at(0, 10, 0),
    endAt: at(0, 11, 15),
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-2",
    categoryId: "cat-bio",
    type: "assignment",
    title: "Biology Lab Report",
    at: at(0, 23, 59),
    status: "doing",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-3",
    categoryId: "cat-personal",
    type: "assignment",
    title: "History Reading — Ch. 12",
    at: at(0, 23, 59),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-4",
    categoryId: "cat-club",
    type: "event",
    title: "Club meeting",
    location: "Union Room 3B",
    at: at(0, 18, 0),
    endAt: at(0, 19, 0),
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-5",
    categoryId: "cat-cs",
    type: "assignment",
    title: "CS 312 Project — Milestone 2",
    at: at(2, 17, 0),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-6",
    categoryId: "cat-personal",
    type: "event",
    title: "Dentist appointment",
    location: "Campus Health Center",
    at: at(1, 14, 30),
    endAt: at(1, 15, 15),
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-7",
    categoryId: "cat-bio",
    type: "assignment",
    title: "Problem Set 4",
    at: at(3, 23, 59),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-8",
    categoryId: "cat-cs",
    type: "assignment",
    title: "Reading response — Ch. 9",
    at: at(4, 23, 59),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-9",
    categoryId: "cat-club",
    type: "event",
    title: "Study session — Physics Lab",
    location: "Room 204",
    at: addHours(new Date(), 0.75).toISOString(),
    endAt: addHours(new Date(), 1.5).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-10",
    categoryId: "cat-personal",
    type: "assignment",
    title: "Essay draft — overdue",
    at: at(-1, 23, 59),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-11",
    categoryId: "cat-bio",
    type: "event",
    title: "Office hours",
    location: "Bio Building 110",
    at: at(6, 13, 0),
    endAt: at(6, 14, 0),
    createdAt: new Date().toISOString(),
  },
  {
    id: "item-12",
    categoryId: "cat-cs",
    type: "assignment",
    title: "Quiz 3 — review",
    at: at(8, 9, 0),
    status: "todo",
    createdAt: new Date().toISOString(),
  },
];
