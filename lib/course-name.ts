import { classMeetingTitle } from "./class-schedule";
import type { Category, Item } from "./types";

/**
 * Display names for classes. Canvas and registrar feeds name a course the way
 * the database stores it — `ENGR-102:204,218,505,568`, `POLS 207 508:` — and
 * that is what a class row used to show. This turns those into the label a
 * person would write (`ENGR 102`) and keeps the section list as detail for a
 * tooltip or a secondary line.
 *
 * Display only: the stored `category.name` is never rewritten, so matching,
 * search, sync and the assistant all keep seeing the original.
 */
export interface CourseLabel {
  /** What to show: `ENGR 102`, or the name untouched when it isn't a course code. */
  label: string;
  /** Secondary detail — `Sections 204, 218` or a course title — when there is one. */
  detail?: string;
  /** The stored name, for tooltips and accessible descriptions. */
  full: string;
}

// Department in capitals (so ordinary words like "Lab 12" or "Week 7" never
// match), an optional separator, then a 2–4 digit course number.
const COURSE = /^\s*([A-Z]{2,5})[\s\-_.]*(\d{2,4}[A-Z]?)(?![\d])(.*)$/;
// Section lists and campus suffixes: digits, commas, capitals — no words.
const SECTIONS_ONLY = /^[\dA-Z,;/&\s.-]*$/;

function trimJunk(s: string) {
  return s.replace(/^[\s:;,\-–—|/.]+/, "").replace(/[\s:;,\-–—|/.]+$/, "");
}

function sectionsDetail(rest: string): string | undefined {
  const parts = rest
    .split(/[\s,;/&]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const numeric = parts.every((p) => /^\d+[A-Z]?$/.test(p));
  if (!numeric) return parts.join(" ");
  return `${parts.length === 1 ? "Section" : "Sections"} ${parts.join(", ")}`;
}

export function parseCourseName(name: string): CourseLabel {
  const full = name;
  const m = COURSE.exec(name);
  if (!m) {
    const label = trimJunk(name) || name.trim();
    return { label, full };
  }
  const code = `${m[1]} ${m[2]}`;
  const rest = trimJunk(m[3] ?? "");
  if (!rest) return { label: code, full };
  if (SECTIONS_ONLY.test(rest)) return { label: code, detail: sectionsDetail(rest), full };
  // `CS 101 - Intro to Programming`: the code is the label, the title the detail.
  return { label: code, detail: rest, full };
}

/** A title that is nothing but a course code (+ sections) → just the code. */
export function courseOnlyLabel(title: string): string | null {
  const m = COURSE.exec(title);
  if (!m) return null;
  const rest = trimJunk(m[3] ?? "");
  if (rest && !SECTIONS_ONLY.test(rest)) return null;
  return `${m[1]} ${m[2]}`;
}

const labelCache = new WeakMap<Category[], Map<string, CourseLabel>>();

/**
 * Labels for every class, with collisions told apart: two `ENGR 102` rows
 * (lecture and lab, say) become `ENGR 102 · 204` and `ENGR 102 · 201`.
 */
export function courseLabels(categories: Category[]): Map<string, CourseLabel> {
  const cached = labelCache.get(categories);
  if (cached) return cached;
  const parsed = categories.map((c) => [c, parseCourseName(c.name)] as const);
  const seen = new Map<string, number>();
  for (const [c, p] of parsed) {
    if (c.archived) continue;
    seen.set(p.label, (seen.get(p.label) ?? 0) + 1);
  }
  const out = new Map<string, CourseLabel>();
  for (const [c, p] of parsed) {
    if ((seen.get(p.label) ?? 0) > 1 && p.detail) {
      const first = p.detail.replace(/^Sections?\s+/, "").split(/[,\s]+/)[0];
      out.set(c.id, { ...p, label: `${p.label} · ${first}` });
    } else {
      out.set(c.id, p);
    }
  }
  labelCache.set(categories, out);
  return out;
}

export function categoryLabel(categories: Category[], category: Pick<Category, "id" | "name"> | undefined): string {
  if (!category) return "No class";
  return courseLabels(categories).get(category.id)?.label ?? parseCourseName(category.name).label;
}

/**
 * The title to show for an item. A course nickname wins for class meetings
 * (existing behaviour); otherwise a feed title that is only a course code —
 * a lecture called `POLS 207 508:` — reads as `POLS 207`. Any title with real
 * words in it is shown exactly as written.
 */
export function itemDisplayTitle(item: Item, category?: Pick<Category, "name" | "classTitle">): string {
  const named = classMeetingTitle(item, category);
  if (named !== item.title) return named;
  return courseOnlyLabel(item.title) ?? item.title;
}
