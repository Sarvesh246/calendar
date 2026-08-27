import { addDays, nextDay, setHours, setMinutes, startOfDay, type Day } from "date-fns";
import type { Category, ItemType } from "./types";

export interface ParsedQuickAdd {
  title: string;
  type: ItemType;
  categoryId?: string;
  at: Date;
  reminderMinutesBefore?: number;
  reminderLabel?: string;
  confidence: {
    date: boolean;
    category: boolean;
    reminder: boolean;
  };
}

export const WEEKDAYS: Record<string, Day> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const ASSIGNMENT_HINTS = [
  "due", "assignment", "hw", "homework", "reading", "lab", "essay", "project",
  "quiz", "exam", "paper", "problem set", "pset", "report", "milestone",
];

/**
 * Local heuristic stand-in for the Gemini quick-add parser. Same shape/contract
 * as the eventual server action — swap the body for a Gemini function-calling
 * call without touching any call sites.
 */
export function parseQuickAdd(raw: string, categories: Category[]): ParsedQuickAdd {
  let text = raw.trim();
  const confidence = { date: false, category: false, reminder: false };

  // --- category --- (full name, or an acronym like "CS" for "Computer Science")
  let categoryId: string | undefined;
  for (const cat of categories) {
    const words = cat.name.split(/\s+/).filter(Boolean);
    const acronym = words.length > 1 ? words.map((w) => w[0]).join("") : null;
    const candidates = [cat.name, ...(acronym ? [acronym] : [])];
    const match = candidates
      .map((needle) => new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i"))
      .find((re) => re.test(text));
    if (match) {
      categoryId = cat.id;
      confidence.category = true;
      text = text.replace(match, "").trim();
      break;
    }
  }

  // --- reminder phrase: "remind me ..." ---
  let reminderMinutesBefore: number | undefined;
  let reminderLabel: string | undefined;
  const remindMatch = text.match(/remind me\s+(.*)$/i);
  if (remindMatch) {
    const phrase = remindMatch[1].toLowerCase();
    confidence.reminder = true;
    if (/night before/.test(phrase)) {
      reminderMinutesBefore = 12 * 60;
      reminderLabel = "Night before";
    } else if (/tomorrow/.test(phrase)) {
      reminderMinutesBefore = 24 * 60;
      reminderLabel = "Tomorrow";
    } else {
      const num = phrase.match(/(\d+)\s*(minute|min|hour|hr|day|week)/);
      if (num) {
        const n = parseInt(num[1], 10);
        const unit = num[2];
        const mult = unit.startsWith("min") ? 1 : unit.startsWith("hour") || unit.startsWith("hr") ? 60 : unit.startsWith("day") ? 1440 : 10080;
        reminderMinutesBefore = n * mult;
        reminderLabel = `${n} ${unit}${n > 1 ? "s" : ""} before`;
      } else {
        reminderMinutesBefore = 60;
        reminderLabel = "1 hour before";
      }
    }
    text = text.replace(remindMatch[0], "").trim();
  }

  // --- type ---
  const isAssignment = ASSIGNMENT_HINTS.some((h) => new RegExp(`\\b${h}\\b`, "i").test(text));
  const type: ItemType = isAssignment ? "assignment" : "event";

  // --- date/time ---
  let base = startOfDay(new Date());
  let hour = isAssignment ? 23 : 12;
  let minute = isAssignment ? 59 : 0;
  let matchedDate = false;

  if (/\btomorrow\b/i.test(text)) {
    base = addDays(base, 1);
    matchedDate = true;
    text = text.replace(/\btomorrow\b/i, "").trim();
  } else if (/\btoday\b/i.test(text)) {
    matchedDate = true;
    text = text.replace(/\btoday\b/i, "").trim();
  } else {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      const re = new RegExp(`\\b${name}\\b`, "i");
      if (re.test(text)) {
        base = nextDay(startOfDay(new Date()), dow);
        matchedDate = true;
        text = text.replace(re, "").trim();
        break;
      }
    }
  }
  confidence.date = matchedDate;

  const timeMatch = text.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const isPM = /pm/i.test(timeMatch[4]);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    hour = h;
    minute = m;
    confidence.date = true;
    text = text.replace(timeMatch[0], "").trim();
  }

  const at = setMinutes(setHours(base, hour), minute);

  // --- title cleanup ---
  let title = text
    .replace(/^[·•\-–—,:\s]+|[·•\-–—,:\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // strip dangling connector words left behind once date/time tokens are removed
  let prevLength: number;
  do {
    prevLength = title.length;
    title = title.replace(/\s*\b(due|at|on|by|for)\b\s*$/i, "").trim();
  } while (title.length !== prevLength && title.length > 0);

  return {
    title: title.length > 0 ? capitalize(title) : "Untitled",
    type,
    categoryId,
    at,
    reminderMinutesBefore,
    reminderLabel,
    confidence,
  };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
