import { matchDatePhrase } from "./date-phrase";
import { parseQuickAdd } from "./quick-add-parser";
import type { BulkDraft, BulkParseResult } from "./bulk-parse";
import type { Category } from "./types";

/**
 * Split a pasted list of events into one draft per event, with no model.
 *
 *   FLIP Interview: Fri Sep 25, 2026 4:45 pm
 *   Location: Rudder 510
 *
 *   FRESH Interview: Fri Sep 25, 2026 2:00 pm
 *   Location: Annex 2nd floor
 *
 * A line with its own date or time starts a new event. `Location: …` style
 * lines belong to the event above them, a bare date line ("Friday, Sep 25")
 * dates the time-only lines under it, and a leading "add these to my calendar:"
 * is instructions rather than an event. Anything without a date is reported as
 * skipped instead of being guessed onto today.
 */

const DAY_NAMES: Record<string, string> = {
  mon: "monday", monday: "monday",
  tue: "tuesday", tues: "tuesday", tuesday: "tuesday",
  wed: "wednesday", wednesday: "wednesday",
  thu: "thursday", thur: "thursday", thurs: "thursday", thursday: "thursday",
  fri: "friday", friday: "friday",
  sat: "saturday", saturday: "saturday",
  sun: "sunday", sunday: "sunday",
};
const WEEKDAY_WORD = /\b(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b\.?,?/gi;
const WEEKDAY_TEST = /\b(?:mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/i;
const RELATIVE_DAY = /\b(today|tomorrow|tonight|yesterday)\b/i;
const TIME_RE = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b|\bat\s+\d{1,2}\b/i;

const LOCATION_KEYS = /^(?:location|where|place|venue|room|address|loc)$/i;
const NOTE_KEYS = /^(?:notes?|description|details?|info|link|url|agenda|attendees?|with)$/i;
const TIME_KEYS = /^(?:date|when|time|day|starts?|start time|at)$/i;
const KEY_VALUE = /^\s*([A-Za-z][A-Za-z ]{1,14}?)\s*:\s*(.+?)\s*$/;
const INTRO = /^(?:please\s+|can you\s+|could you\s+)?(?:add|put|create|schedule|book|set up|remind me(?: about)?)\b/i;
const INLINE_LOCATION = /(?:[,;]\s*|\s+[-–—]\s+|\s{2,})(?:location|where|room|venue)\s*:\s*(.+)$/i;

interface Entry {
  head: string;
  timeText: string[];
  location?: string;
  notes: string[];
  signal: boolean;
  headerDate?: Date;
}

function hasDateWord(text: string): boolean {
  return Boolean(matchDatePhrase(text)) || RELATIVE_DAY.test(text) || WEEKDAY_TEST.test(text);
}

function hasSignal(text: string): boolean {
  return hasDateWord(text) || TIME_RE.test(text);
}

/** "Fri Sep 25, 2026 4:45 pm" → drop the redundant weekday; "fri 3pm" → "friday 3pm". */
function normalizeHead(text: string): string {
  if (matchDatePhrase(text)) return text.replace(WEEKDAY_WORD, " ").replace(/\s{2,}/g, " ").trim();
  return text.replace(WEEKDAY_WORD, (m) => {
    const key = m.replace(/[.,]/g, "").toLowerCase();
    return (DAY_NAMES[key] ?? m) + (/[.,]$/.test(m) ? "" : "");
  });
}

/** A line that is only a date ("Friday, Sep 25:") heads the lines beneath it. */
function headerDateOf(line: string, now: Date): Date | null {
  const phrase = matchDatePhrase(line, now);
  if (!phrase || phrase.end) return null;
  const rest = (line.slice(0, phrase.index) + line.slice(phrase.index + phrase.text.length))
    .replace(WEEKDAY_WORD, " ")
    .replace(/[\s,:\-–—|]+/g, "");
  return rest === "" ? phrase.start : null;
}

export function parseMultiAdd(raw: string, categories: Category[], now = new Date()): BulkParseResult {
  const drafts: BulkDraft[] = [];
  const skipped: string[] = [];
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/[​ ]/g, " ").replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim());

  // Instructions ("add these to my calendar:") are not an event.
  const firstIdx = lines.findIndex(Boolean);
  if (firstIdx >= 0 && INTRO.test(lines[firstIdx]) && (/:\s*$/.test(lines[firstIdx]) || !hasSignal(lines[firstIdx]))) {
    lines[firstIdx] = "";
  }

  const entries: Entry[] = [];
  let current = null as Entry | null;
  let closed = true;
  let header: Date | undefined;

  const start = (line: string) => {
    const location = INLINE_LOCATION.exec(line);
    const head = location ? line.slice(0, location.index) : line;
    current = {
      head,
      timeText: [],
      notes: [],
      signal: hasSignal(head),
      ...(location ? { location: location[1].trim() } : {}),
      ...(header ? { headerDate: header } : {}),
    };
    entries.push(current);
    closed = false;
  };

  for (const line of lines) {
    if (!line) {
      closed = true;
      continue;
    }
    const kv = KEY_VALUE.exec(line);
    if (kv && !matchDatePhrase(kv[1]) && (LOCATION_KEYS.test(kv[1]) || NOTE_KEYS.test(kv[1]) || TIME_KEYS.test(kv[1]))) {
      if (!current) continue;
      if (LOCATION_KEYS.test(kv[1])) current.location = kv[2];
      else if (TIME_KEYS.test(kv[1])) {
        current.timeText.push(kv[2]);
        current.signal = true;
      } else current.notes.push(kv[2]);
      continue;
    }
    const day = headerDateOf(line, now);
    if (day) {
      header = day;
      current = null;
      closed = true;
      continue;
    }
    const signal = hasSignal(line);
    if (current && !closed && current.signal && !signal) {
      current.notes.push(line);
      continue;
    }
    start(line);
  }

  for (const entry of entries) {
    const text = normalizeHead([entry.head, ...entry.timeText].join(" ").trim());
    const dated = hasDateWord(text) || Boolean(entry.headerDate);
    if (!dated || !text) {
      skipped.push(entry.head);
      continue;
    }
    const parsed = parseQuickAdd(text, categories, entry.headerDate ? { anchor: entry.headerDate } : undefined);
    const timed = TIME_RE.test(text);
    const allDay = Boolean(parsed.allDay) || !timed;
    const at = allDay ? new Date(new Date(parsed.at).setHours(12, 0, 0, 0)) : parsed.at;
    const location = entry.location || parsed.location;
    drafts.push({
      title: parsed.title,
      type: parsed.type,
      at,
      ...(parsed.endAt && +parsed.endAt > +at ? { endAt: parsed.endAt } : {}),
      allDay,
      ...(location ? { location } : {}),
      ...(entry.notes.length ? { description: entry.notes.join(" · ") } : {}),
      ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
      source: entry.head,
    });
  }

  return { drafts, skipped };
}
