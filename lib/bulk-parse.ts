import { setHours, setMinutes } from "date-fns";
import { matchDatePhrase } from "./date-phrase";
import type { Category, Item, ItemType } from "./types";

/**
 * Turn a pasted block — a schedule table, a syllabus excerpt, a list of
 * deadlines — into one draft per line.
 *
 * Quick-add handled exactly one item and ignored written dates, so pasting a
 * career-fair schedule produced a single entry titled after the whole blob,
 * dated today. Most of what people paste is already tabular (a date column and
 * a name column), which is enough structure to split on without a model.
 */

export interface BulkDraft {
  title: string;
  type: ItemType;
  at: Date;
  endAt?: Date;
  allDay: boolean;
  location?: string;
  description?: string;
  categoryId?: string;
  /** The line this came from, shown in the preview so the user can check it. */
  source: string;
}

const ASSIGNMENT_HINTS =
  /\b(due|assignment|hw|homework|reading|lab|essay|project|quiz|exam|paper|problem set|pset|report|midterm|final)\b/i;

/** Trailing footnote markers and separators left over from a copied table. */
function cleanCell(v: string): string {
  return v
    .replace(/[​ ]/g, " ")
    .replace(/^[\s|·•\-–—,:]+|[\s|·•\-–—,:]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A title shouldn't keep the asterisk that pointed at a footnote. */
function cleanTitle(v: string): string {
  return cleanCell(v).replace(/[*†‡]+$/g, "").trim();
}

function looksLikeContact(v: string): boolean {
  return /@|^https?:\/\//i.test(v);
}

/** Split one row into cells: real tabs first, then runs of spaces, then pipes. */
function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map(cleanCell).filter(Boolean);
  if (line.includes("|")) return line.split("|").map(cleanCell).filter(Boolean);
  const bySpaces = line.split(/\s{2,}/).map(cleanCell).filter(Boolean);
  if (bySpaces.length > 1) return bySpaces;
  return [cleanCell(line)];
}

function detectType(text: string): ItemType {
  return ASSIGNMENT_HINTS.test(text) ? "assignment" : "event";
}

function matchCategory(text: string, categories: Category[]): string | undefined {
  for (const cat of categories) {
    const name = cat.name?.trim();
    if (!name) continue;
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      return cat.id;
    }
    // Course codes like "ENGR-102:201,204" — match on the code alone.
    const code = name.match(/^([A-Za-z]{2,5})[\s-]?(\d{2,4})/);
    if (code && new RegExp(`\\b${code[1]}[\\s-]?${code[2]}\\b`, "i").test(text)) return cat.id;
  }
  return undefined;
}

function draftFromLine(line: string, categories: Category[], now: Date): BulkDraft | null {
  const cells = splitCells(line);
  if (cells.length === 0) return null;

  // The date can be its own column or buried in the prose — find whichever cell
  // carries one and treat the rest as content.
  let dateCellIndex = -1;
  let phrase: ReturnType<typeof matchDatePhrase> = null;
  for (let i = 0; i < cells.length; i += 1) {
    const hit = matchDatePhrase(cells[i], now);
    if (hit) {
      dateCellIndex = i;
      phrase = hit;
      break;
    }
  }
  if (!phrase) return null;

  const rest: string[] = [];
  cells.forEach((cell, i) => {
    if (i !== dateCellIndex) {
      rest.push(cell);
      return;
    }
    // Keep anything else that shared the date's cell ("Sept. 11 Career Fair").
    const leftover = cleanCell(
      cell.slice(0, phrase!.index) + cell.slice(phrase!.index + phrase!.text.length)
    );
    if (leftover) rest.push(leftover);
  });

  const titleCell = rest.find((c) => !looksLikeContact(c));
  const title = cleanTitle(titleCell ?? "") || "Untitled";
  const remaining = rest.filter((c) => c !== titleCell);
  const location = remaining.find((c) => !looksLikeContact(c));
  const extras = remaining.filter((c) => c !== location);

  const haystack = cells.join(" ");
  const type = detectType(haystack);
  const allDay = true; // a written date with no clock time is an all-day entry
  const at = setMinutes(setHours(phrase.start, 12), 0);

  return {
    title,
    type,
    at,
    ...(phrase.end ? { endAt: setMinutes(setHours(phrase.end, 12), 0) } : {}),
    allDay,
    ...(location ? { location } : {}),
    ...(extras.length ? { description: extras.join(" · ") } : {}),
    ...(matchCategory(haystack, categories) ? { categoryId: matchCategory(haystack, categories) } : {}),
    source: cleanCell(line),
  };
}

export interface BulkParseResult {
  drafts: BulkDraft[];
  /** Lines that looked like content but carried no date we could read. */
  skipped: string[];
}

/** True when `raw` is worth offering as a multi-item add. */
export function looksLikeBulkPaste(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  let dated = 0;
  for (const line of lines) {
    if (matchDatePhrase(line)) dated += 1;
    if (dated >= 2) return true;
  }
  return false;
}

export function parseBulk(
  raw: string,
  categories: Category[],
  now = new Date()
): BulkParseResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const drafts: BulkDraft[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const draft = draftFromLine(line, categories, now);
    if (draft) drafts.push(draft);
    else skipped.push(cleanCell(line));
  }
  return { drafts, skipped };
}

/** Shape a draft for `addItem`. */
export function toNewItem(
  draft: BulkDraft,
  fallbackCategoryId: string | undefined
): Omit<Item, "id" | "createdAt"> {
  return {
    title: draft.title,
    type: draft.type,
    categoryId: draft.categoryId ?? fallbackCategoryId ?? "",
    at: draft.at.toISOString(),
    ...(draft.endAt ? { endAt: draft.endAt.toISOString() } : {}),
    ...(draft.allDay ? { allDay: true } : {}),
    ...(draft.location ? { location: draft.location } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.type === "event" ? {} : { status: "todo" as const }),
  };
}
