/**
 * What a syllabus says besides its due dates — who teaches the course, how to
 * reach them, how it is graded, what the rules are. Pulled out of the PDF in
 * the same model call that finds the due dates (so it costs no extra quota),
 * stored on the class, and read back by the assistant to answer questions like
 * "what's the late policy in econ" without calling a model at all.
 *
 * Everything here is untrusted model output: normalize before storing, clip
 * every string, and never let one class's blob grow without bound.
 */

export type SyllabusRole = "instructor" | "ta" | "other";

export interface SyllabusPerson {
  role: SyllabusRole;
  name: string;
  email?: string;
  phone?: string;
  office?: string;
  officeHours?: string;
}

export interface SyllabusGradeWeight {
  component: string;
  /** As written: "20%", "150 pts", "drop lowest 2". */
  weight: string;
}

export interface SyllabusGradeCutoff {
  grade: string;
  range: string;
}

export interface SyllabusPolicy {
  /** Short label: "Late work", "Attendance", "AI use". */
  topic: string;
  text: string;
}

export interface SyllabusKeyDate {
  label: string;
  /** Local calendar day `YYYY-MM-DD`. */
  date: string;
  /** Last day of a span (spring break), when given. */
  endDate?: string;
}

export interface SyllabusInfo {
  courseName?: string;
  courseCode?: string;
  term?: string;
  description?: string;
  meetings?: string;
  location?: string;
  website?: string;
  prerequisites?: string;
  people: SyllabusPerson[];
  grading: SyllabusGradeWeight[];
  gradeScale: SyllabusGradeCutoff[];
  materials: string[];
  policies: SyllabusPolicy[];
  keyDates: SyllabusKeyDate[];
  /** When this was read from a PDF. */
  importedAt: string;
  fileName?: string;
}

const LIMITS = {
  short: 160,
  text: 700,
  people: 8,
  grading: 20,
  scale: 16,
  materials: 12,
  policies: 24,
  keyDates: 30,
};

function str(v: unknown, max = LIMITS.short): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

function opt(v: unknown, max = LIMITS.short): string | undefined {
  return str(v, max) || undefined;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymd(v: unknown): string | undefined {
  const s = str(v, 10);
  if (!YMD.test(s)) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? s : undefined;
}

function role(v: unknown): SyllabusRole {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (/\b(?:ta|teaching assistant|tf|grader|la|learning assistant)\b/.test(s)) return "ta";
  if (/\b(?:instructor|professor|prof|lecturer|teacher|faculty)\b/.test(s)) return "instructor";
  return s === "ta" ? "ta" : s === "instructor" ? "instructor" : "other";
}

/**
 * Accept whatever the model (or a synced row, or an old backup) handed us and
 * return a bounded, well-typed record — or undefined when there is nothing
 * worth keeping.
 */
export function normalizeSyllabusInfo(raw: unknown, meta?: { importedAt?: string; fileName?: string }): SyllabusInfo | undefined {
  const o = rec(raw);
  const people: SyllabusPerson[] = [];
  for (const p of arr(o.people).slice(0, LIMITS.people)) {
    const r = rec(p);
    const name = str(r.name, 80);
    if (!name) continue;
    const email = str(r.email, 120);
    people.push({
      role: role(r.role),
      name,
      ...(email && /@/.test(email) ? { email } : {}),
      ...(opt(r.phone, 40) ? { phone: opt(r.phone, 40) } : {}),
      ...(opt(r.office, 120) ? { office: opt(r.office, 120) } : {}),
      ...(opt(r.officeHours, 240) ? { officeHours: opt(r.officeHours, 240) } : {}),
    });
  }
  const grading = arr(o.grading)
    .slice(0, LIMITS.grading)
    .map((g) => ({ component: str(rec(g).component, 80), weight: str(rec(g).weight, 60) }))
    .filter((g) => g.component && g.weight);
  const gradeScale = arr(o.gradeScale)
    .slice(0, LIMITS.scale)
    .map((g) => ({ grade: str(rec(g).grade, 8), range: str(rec(g).range, 40) }))
    .filter((g) => g.grade && g.range);
  const materials = arr(o.materials).map((m) => str(m, 200)).filter(Boolean).slice(0, LIMITS.materials);
  const policies = arr(o.policies)
    .slice(0, LIMITS.policies)
    .map((p) => ({ topic: str(rec(p).topic, 60), text: str(rec(p).text, LIMITS.text) }))
    .filter((p) => p.topic && p.text);
  const keyDates: SyllabusKeyDate[] = [];
  for (const k of arr(o.keyDates).slice(0, LIMITS.keyDates)) {
    const r = rec(k);
    const label = str(r.label, 100);
    const date = ymd(r.date);
    if (!label || !date) continue;
    const endDate = ymd(r.endDate);
    keyDates.push({ label, date, ...(endDate && endDate > date ? { endDate } : {}) });
  }
  keyDates.sort((a, b) => a.date.localeCompare(b.date));

  const info: SyllabusInfo = {
    ...(opt(o.courseName, 120) ? { courseName: opt(o.courseName, 120) } : {}),
    ...(opt(o.courseCode, 40) ? { courseCode: opt(o.courseCode, 40) } : {}),
    ...(opt(o.term, 40) ? { term: opt(o.term, 40) } : {}),
    ...(opt(o.description, LIMITS.text) ? { description: opt(o.description, LIMITS.text) } : {}),
    ...(opt(o.meetings, 200) ? { meetings: opt(o.meetings, 200) } : {}),
    ...(opt(o.location, 120) ? { location: opt(o.location, 120) } : {}),
    ...(opt(o.website, 300) && /^https?:\/\//i.test(str(o.website, 300)) ? { website: opt(o.website, 300) } : {}),
    ...(opt(o.prerequisites, 300) ? { prerequisites: opt(o.prerequisites, 300) } : {}),
    people,
    grading,
    gradeScale,
    materials,
    policies,
    keyDates,
    importedAt: meta?.importedAt ?? (typeof o.importedAt === "string" ? o.importedAt : new Date().toISOString()),
    ...(meta?.fileName ?? opt(o.fileName, 200) ? { fileName: meta?.fileName ?? opt(o.fileName, 200) } : {}),
  };
  return hasSyllabusContent(info) ? info : undefined;
}

export function hasSyllabusContent(info: SyllabusInfo | undefined): info is SyllabusInfo {
  if (!info) return false;
  return Boolean(
    info.people.length ||
      info.grading.length ||
      info.gradeScale.length ||
      info.materials.length ||
      info.policies.length ||
      info.keyDates.length ||
      info.description ||
      info.meetings ||
      info.prerequisites ||
      info.website
  );
}

/** Compact plain text for a model prompt — only sent when a question needs it. */
export function syllabusDigest(className: string, info: SyllabusInfo): string {
  const lines: string[] = [`Syllabus for ${className}${info.term ? ` (${info.term})` : ""}:`];
  if (info.description) lines.push(`About: ${info.description}`);
  if (info.meetings || info.location) lines.push(`Meets: ${[info.meetings, info.location].filter(Boolean).join(", ")}`);
  for (const p of info.people) {
    lines.push(`${p.role === "ta" ? "TA" : p.role === "instructor" ? "Instructor" : "Contact"}: ${[p.name, p.email, p.office && `office ${p.office}`, p.officeHours && `office hours ${p.officeHours}`].filter(Boolean).join("; ")}`);
  }
  if (info.grading.length) lines.push(`Grading: ${info.grading.map((g) => `${g.component} ${g.weight}`).join(", ")}`);
  if (info.gradeScale.length) lines.push(`Scale: ${info.gradeScale.map((g) => `${g.grade} ${g.range}`).join(", ")}`);
  if (info.materials.length) lines.push(`Materials: ${info.materials.join("; ")}`);
  if (info.prerequisites) lines.push(`Prerequisites: ${info.prerequisites}`);
  for (const p of info.policies) lines.push(`${p.topic}: ${p.text}`);
  if (info.keyDates.length) lines.push(`Key dates: ${info.keyDates.map((k) => `${k.label} ${k.date}${k.endDate ? `–${k.endDate}` : ""}`).join("; ")}`);
  if (info.website) lines.push(`Website: ${info.website}`);
  return lines.join("\n");
}
