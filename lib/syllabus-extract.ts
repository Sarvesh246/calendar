import { wallTimeInZoneToIso } from "./date-utils";
import { MAX_SYLLABUS_PDF_BYTES } from "./syllabus-limits";
import type { SyllabusDraft } from "./syllabus-match";
import type { ItemType } from "./types";

export { MAX_SYLLABUS_BODY, MAX_SYLLABUS_PDF_BYTES } from "./syllabus-limits";

/** Error codes returned by POST /api/import-syllabus. HTTP status varies. */
export type SyllabusExtractError =
  | "assistant-not-configured"
  | "assistant-busy"
  | "assistant-unreachable"
  | "forbidden"
  | "rate-limited"
  | "payload-too-large"
  | "bad-request"
  | "missing-pdf"
  | "invalid-pdf";

export const SYLLABUS_ITEM_KINDS = [
  "homework",
  "quiz",
  "exam",
  "paper",
  "lab",
  "project",
  "discussion",
  "other",
] as const;

export type SyllabusItemKind = (typeof SYLLABUS_ITEM_KINDS)[number];

export type SyllabusExtractedItem = {
  title: string;
  /** Local calendar day `YYYY-MM-DD`. */
  dueDate: string;
  /** 24-hour `HH:mm` when the syllabus gave a clock time. */
  dueTime?: string;
  /** 24-hour `HH:mm` end of a timed sitting, only when the PDF gave one. */
  endTime?: string;
  type: ItemType;
  kind: SyllabusItemKind;
  notes?: string;
};

export type SyllabusExtractResult = {
  courseName: string;
  courseCode: string;
  items: SyllabusExtractedItem[];
};

export type SyllabusCategoryHint = { id: string; name: string };

const SYLLABUS_EXTRACT_ERROR_CODES = new Set<string>([
  "assistant-not-configured",
  "assistant-busy",
  "assistant-unreachable",
  "forbidden",
  "rate-limited",
  "payload-too-large",
  "bad-request",
  "missing-pdf",
  "invalid-pdf",
]);

const MAX_ITEMS = 200;
const MAX_CATEGORIES = 80;
const MAX_TITLE = 200;
const MAX_NOTES = 500;
const MAX_COURSE_NAME = 120;
const MAX_COURSE_CODE = 40;
const PAST_MONTHS = 18;
const FUTURE_YEARS = 2;

const KIND_SET = new Set<string>(SYLLABUS_ITEM_KINDS);

const KIND_ALIASES: Record<string, SyllabusItemKind> = {
  hw: "homework",
  "h.w.": "homework",
  "h.w": "homework",
  homework: "homework",
  assignment: "homework",
  "problem set": "homework",
  pset: "homework",
  quiz: "quiz",
  quizzes: "quiz",
  exam: "exam",
  midterm: "exam",
  final: "exam",
  test: "exam",
  paper: "paper",
  essay: "paper",
  report: "paper",
  lab: "lab",
  laboratory: "lab",
  project: "project",
  milestone: "project",
  discussion: "discussion",
  "discussion board": "discussion",
  other: "other",
};

/** `%PDF` magic bytes — browsers sometimes send an empty or octet-stream type. */
export function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function isSyllabusExtractError(code: unknown): code is SyllabusExtractError {
  return typeof code === "string" && SYLLABUS_EXTRACT_ERROR_CODES.has(code);
}

export function isSyllabusRetryableError(code: SyllabusExtractError): boolean {
  return code === "assistant-busy" || code === "assistant-unreachable";
}

export class SyllabusExtractRequestError extends Error {
  readonly code: SyllabusExtractError;
  readonly status: number;
  constructor(code: SyllabusExtractError, status: number) {
    super(syllabusExtractErrorMessage(code, status));
    this.name = "SyllabusExtractRequestError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Map an API `error` code and/or HTTP status to a typed extract error.
 * Transient Gemini failures are already retried on the server; these codes
 * are what remains after that. Invalid PDF / too-large / not-configured stay distinct.
 */
export function syllabusErrorFromResponse(
  code: unknown,
  status: number
): SyllabusExtractError | undefined {
  if (isSyllabusExtractError(code)) return code;
  if (status === 429) return "rate-limited";
  if (status === 403) return "forbidden";
  if (status === 413) return "payload-too-large";
  if (status === 503 || status === 502) return "assistant-busy";
  if (status === 504 || status === 408 || status === 0) return "assistant-unreachable";
  return undefined;
}

export function syllabusExtractErrorMessage(code: string | undefined, status: number): string {
  const maxMb = (MAX_SYLLABUS_PDF_BYTES / (1024 * 1024)).toFixed(1);
  if (code === "assistant-not-configured") return "Syllabus reading isn't set up on this server.";
  if (code === "assistant-busy") return "The reader is busy — try again in a moment.";
  if (code === "assistant-unreachable") return "Couldn't reach the syllabus reader. Try again.";
  if (code === "forbidden" || status === 403) return "This request was blocked.";
  if (code === "rate-limited" || status === 429) return "Too many syllabus reads — try again in a bit.";
  if (code === "payload-too-large" || status === 413) {
    return `That PDF is too large (max ${maxMb} MB).`;
  }
  if (code === "missing-pdf") return "Choose a PDF to import.";
  if (code === "invalid-pdf") return "That file doesn't look like a PDF.";
  if (code === "bad-request") return "Couldn't read that syllabus.";
  if (status === 503 || status === 502) return "The reader is busy — try again in a moment.";
  if (status === 504 || status === 408 || status === 0) {
    return "Couldn't reach the syllabus reader. Try again.";
  }
  return "Couldn't read that syllabus.";
}

export function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** One extra attempt after a transient busy/unreachable — not for invalid PDF / 413 / 429. */
export async function retrySyllabusExtractOnce<T>(
  run: () => Promise<T>,
  opts: {
    signal: AbortSignal;
    delayMs: number;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
  }
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (opts.signal.aborted) throw err;
    if (err instanceof SyllabusExtractRequestError && isSyllabusRetryableError(err.code)) {
      await (opts.wait ?? sleepWithSignal)(opts.delayMs, opts.signal);
      return await run();
    }
    throw err;
  }
}

export function looksLikeSyllabusPdf(file: { type?: string; name: string }): boolean {
  const type = (file.type || "").toLowerCase();
  const named = file.name.toLowerCase().endsWith(".pdf");
  if (type === "application/pdf") return true;
  if (type === "application/octet-stream" || type === "") return named;
  return false;
}

/** Convert a normalized extract row to a store draft. Does not invent an end time. */
export function extractedItemToDraft(item: SyllabusExtractedItem, timeZone: string): SyllabusDraft {
  const start = parseHHmm(item.dueTime);
  const end = parseHHmm(item.endTime);
  const hour = start?.hour ?? 23;
  const minute = start?.minute ?? 59;
  const draft: SyllabusDraft = {
    title: item.title,
    at: wallTimeInZoneToIso(item.dueDate, hour, minute, timeZone),
    type: item.type,
    kind: item.kind,
    ...(item.notes?.trim() ? { notes: item.notes.trim() } : {}),
  };
  if (start && end) {
    const startMin = start.hour * 60 + start.minute;
    const endMin = end.hour * 60 + end.minute;
    if (endMin > startMin) {
      draft.endAt = wallTimeInZoneToIso(item.dueDate, end.hour, end.minute, timeZone);
    } else if (endMin < startMin) {
      draft.endAt = wallTimeInZoneToIso(addDaysYmd(item.dueDate, 1), end.hour, end.minute, timeZone);
    }
  }
  return draft;
}

export function parseCategoryHints(raw: unknown): SyllabusCategoryHint[] {
  let value = raw;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    try {
      value = JSON.parse(t) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: SyllabusCategoryHint[] = [];
  for (const c of value.slice(0, MAX_CATEGORIES)) {
    if (typeof c === "string") {
      const name = c.trim();
      if (name) out.push({ id: "", name });
      continue;
    }
    if (!c || typeof c !== "object") continue;
    const rec = c as { id?: unknown; name?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    out.push({ id: typeof rec.id === "string" ? rec.id : "", name });
  }
  return out;
}

export function syllabusDateWindow(now: Date, timeZone: string): { min: string; max: string } {
  const today = zonedYmd(now, timeZone);
  return { min: addMonthsYmd(today, -PAST_MONTHS), max: addMonthsYmd(today, FUTURE_YEARS * 12) };
}

export function isSyllabusDueDateInWindow(dueDate: string, now: Date, timeZone: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  const { min, max } = syllabusDateWindow(now, timeZone);
  return dueDate >= min && dueDate <= max;
}

/**
 * Parse a model date to `YYYY-MM-DD`. Bare month/day uses the academic year
 * around `now` (Fall starts August; Jun–Jul count as the upcoming fall).
 * Dates outside ~18 months past / ~2 years ahead are dropped.
 */
export function inferSyllabusDueDate(raw: string, now: Date, timeZone: string): string | undefined {
  const parsed = parseDateParts(raw.trim());
  if (!parsed) return undefined;
  const { y, m, d } = zonedYmdParts(now, timeZone);
  const year = parsed.year ?? inferAcademicYear(parsed.month, y, m);
  const due = validYmd(year, parsed.month, parsed.day);
  if (due && isSyllabusDueDateInWindow(due, now, timeZone)) return due;
  if (parsed.year) return undefined;
  const fallback = nearestInWindow(parsed.month, parsed.day, now, timeZone);
  return fallback;
}

export function normalizeDueTime(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const s = raw.trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = parseInt(ampm[2], 10);
    const pm = ampm[3].toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    if (h > 23 || min > 59) return undefined;
    return pad2(h) + ":" + pad2(min);
  }
  const h24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!h24) return undefined;
  const h = parseInt(h24[1], 10);
  const min = parseInt(h24[2], 10);
  if (h > 23 || min > 59) return undefined;
  return pad2(h) + ":" + pad2(min);
}

export function normalizeSyllabusExtraction(
  raw: unknown,
  nowIso: string,
  timeZone: string
): SyllabusExtractResult {
  const now = new Date(nowIso);
  const instant = Number.isNaN(now.getTime()) ? new Date() : now;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const itemsIn = Array.isArray(obj.items) ? obj.items : [];
  const items: SyllabusExtractedItem[] = [];
  for (const row of itemsIn.slice(0, MAX_ITEMS)) {
    const item = normalizeItem(row, instant, timeZone);
    if (item) items.push(item);
  }
  return {
    courseName: clip(str(obj.courseName), MAX_COURSE_NAME),
    courseCode: clip(str(obj.courseCode), MAX_COURSE_CODE),
    items,
  };
}

function normalizeItem(row: unknown, now: Date, timeZone: string): SyllabusExtractedItem | undefined {
  if (!row || typeof row !== "object") return undefined;
  const rec = row as Record<string, unknown>;
  const title = clip(str(rec.title), MAX_TITLE);
  if (!title) return undefined;
  const dueDate = inferSyllabusDueDate(str(rec.dueDate), now, timeZone);
  if (!dueDate) return undefined;
  const type = normalizeType(rec.type);
  const kind = normalizeKind(rec.kind, title);
  const dueTime = normalizeDueTime(rec.dueTime);
  const endTime = normalizeDueTime(rec.endTime);
  const notes = clip(str(rec.notes), MAX_NOTES) || undefined;
  const item: SyllabusExtractedItem = { title, dueDate, type, kind };
  if (dueTime) item.dueTime = dueTime;
  if (endTime) item.endTime = endTime;
  if (notes) item.notes = notes;
  return item;
}

function normalizeType(raw: unknown): ItemType {
  if (raw === "event" || raw === "assignment" || raw === "task") return raw;
  return "assignment";
}

function normalizeKind(raw: unknown, title: string): SyllabusItemKind {
  const direct = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (KIND_SET.has(direct)) return direct as SyllabusItemKind;
  if (direct && KIND_ALIASES[direct]) return KIND_ALIASES[direct];
  const blob = `${direct} ${title}`.toLowerCase();
  for (const [alias, kind] of Object.entries(KIND_ALIASES)) {
    if (alias.length < 3) continue;
    if (blob.includes(alias)) return kind;
  }
  if (/\bhw\b/.test(blob)) return "homework";
  return "other";
}

function parseDateParts(raw: string): { year?: number; month: number; day: number } | undefined {
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    return validYmd(year, month, day) ? { year, month, day } : undefined;
  }
  const us = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const month = parseInt(us[1], 10);
    const day = parseInt(us[2], 10);
    let year = parseInt(us[3], 10);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return validYmd(year, month, day) ? { year, month, day } : undefined;
  }
  const md = raw.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (md) {
    const month = parseInt(md[1], 10);
    const day = parseInt(md[2], 10);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : undefined;
  }
  return undefined;
}

/** Fall starts August. Jan–May still belong to the fall that started last year. */
function inferAcademicYear(month: number, nowY: number, nowM: number): number {
  const ayStart = nowM >= 8 ? nowY : nowM <= 5 ? nowY - 1 : nowY;
  return month >= 8 ? ayStart : ayStart + 1;
}

function nearestInWindow(month: number, day: number, now: Date, timeZone: string): string | undefined {
  const { y } = zonedYmdParts(now, timeZone);
  const today = zonedYmd(now, timeZone);
  let best: string | undefined;
  let bestDist = Infinity;
  for (const year of [y - 1, y, y + 1, y + 2]) {
    const due = validYmd(year, month, day);
    if (!due || !isSyllabusDueDateInWindow(due, now, timeZone)) continue;
    const dist = Math.abs(ymdIndex(due) - ymdIndex(today));
    if (dist < bestDist) {
      best = due;
      bestDist = dist;
    }
  }
  return best;
}

function validYmd(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return undefined;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function parseHHmm(raw?: string): { hour: number; minute: number } | undefined {
  if (!raw) return undefined;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return undefined;
  }
  return { hour, minute };
}

function ymdIndex(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function zonedYmd(instant: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
  }
}

function zonedYmdParts(instant: Date, timeZone: string): { y: number; m: number; d: number } {
  const [y, m, d] = zonedYmd(instant, timeZone).split("-").map(Number);
  return { y, m, d };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max).trim() : s;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
