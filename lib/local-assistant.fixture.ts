/** Shared calendar for the local-assistant tests: Thu Sep 24 2026, 10:00. */
import type { AssistantCtx } from "./ai-assistant";
import type { SyllabusInfo } from "./syllabus-info";
import type { Category, Item } from "./types";

export const NOW = new Date(2026, 8, 24, 10, 0, 0);
export const at = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

export const econSyllabus: SyllabusInfo = {
  courseName: "Principles of Economics",
  courseCode: "ECON 101",
  term: "Fall 2026",
  description: "Supply and demand, market structures, and the basics of macroeconomic policy.",
  meetings: "Thu 2:00–3:15 PM",
  location: "Lyon Hall 204",
  people: [
    { role: "instructor", name: "Dr. Maria Lopez", email: "mlopez@uni.edu", office: "Lyon 310", officeHours: "Tue 2–4 PM" },
    { role: "ta", name: "Sam Chen", email: "schen@uni.edu", officeHours: "Wed 11 AM–12 PM, Library 2F" },
  ],
  grading: [
    { component: "Problem sets", weight: "25%" },
    { component: "Midterm exam", weight: "30%" },
    { component: "Final exam", weight: "35%" },
    { component: "Participation", weight: "10%" },
  ],
  gradeScale: [
    { grade: "A", range: "93–100" },
    { grade: "B", range: "83–86" },
  ],
  materials: ["Mankiw, Principles of Economics, 9th ed."],
  policies: [
    { topic: "Late work", text: "Problem sets lose 10% per day late, up to 3 days; after that they get no credit." },
    { topic: "AI use", text: "AI tools may be used to study but not to write submitted work." },
    { topic: "Attendance", text: "Attendance is taken in section; more than three unexcused absences lowers participation." },
    { topic: "Makeup exams", text: "Makeup exams are only given with documentation arranged before the exam." },
  ],
  keyDates: [
    { label: "First day of classes", date: "2026-08-24" },
    { label: "Last day to drop", date: "2026-10-09" },
    { label: "Thanksgiving break", date: "2026-11-25", endDate: "2026-11-29" },
  ],
  importedAt: "2026-09-01T00:00:00.000Z",
};

export function makeCtx(): AssistantCtx {
  let seq = 0;
  const item = (p: Partial<Item> & Pick<Item, "title" | "type" | "at">): Item => {
    seq += 1;
    return { id: `i${seq}`, categoryId: "c3", createdAt: at(9, 1), ...p };
  };
  const lecture = (m: number, d: number) =>
    item({ title: "CS 101 Lecture", type: "event", at: at(m, d, 10), endAt: at(m, d, 11, 15), categoryId: "c1", location: "Hall B", repeat: { freq: "weekly", byDay: [1, 3, 5] }, repeatId: "r1" });
  const categories: Category[] = [
    { id: "c1", name: "CS 101", color: "#007AFF" },
    { id: "c2", name: "Econ", color: "#34C759", syllabus: econSyllabus },
    { id: "c3", name: "Personal", color: "#FF9500" },
  ];
  const items: Item[] = [
    lecture(9, 23),
    lecture(9, 25),
    lecture(9, 28),
    lecture(9, 30),
    item({ title: "Econ Seminar", type: "event", at: at(9, 24, 14), endAt: at(9, 24, 15, 15), categoryId: "c2", repeat: { freq: "weekly", byDay: [4] }, repeatId: "r2" }),
    item({ title: "Econ Seminar", type: "event", at: at(10, 1, 14), endAt: at(10, 1, 15, 15), categoryId: "c2", repeat: { freq: "weekly", byDay: [4] }, repeatId: "r2" }),
    item({ title: "Dentist appointment", type: "event", at: at(10, 6, 14), location: "Main St Dental" }),
    item({ title: "Essay draft", type: "assignment", at: at(9, 25, 23, 59), categoryId: "c1", status: "todo" }),
    item({ title: "Problem Set 3", type: "assignment", at: at(9, 24, 23, 59), categoryId: "c2", status: "doing" }),
    item({ title: "Problem Set 4", type: "assignment", at: at(10, 1, 23, 59), categoryId: "c2", status: "todo" }),
    item({ title: "Reading response", type: "assignment", at: at(9, 22, 23, 59), categoryId: "c1", status: "todo" }),
    item({ title: "Lab report", type: "assignment", at: at(9, 23, 23, 59), categoryId: "c1", status: "done", completedAt: at(9, 23, 20) }),
    item({ title: "Buy textbook", type: "task", at: at(9, 26, 23, 59), status: "todo" }),
    item({ title: "Midterm exam", type: "event", at: at(10, 8, 14), endAt: at(10, 8, 15, 30), categoryId: "c2", location: "Lyon Hall 204" }),
  ];
  return { items, categories, clock24h: false, weekStartsOn: 0 };
}
