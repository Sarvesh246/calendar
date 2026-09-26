import { formatOffsetLabel } from "./reminder-defaults";

export interface ParsedReminderOffset {
  offsetMinutes: number;
  label: string;
}

const WORD_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  the: 1,
  one: 1,
  two: 2,
  couple: 2,
  few: 2,
  several: 3,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

const MAX_OFFSET = 14 * 24 * 60;
const MAX_REMINDERS = 4;

/**
 * Pull every "a day before" / "a couple hours before" / "remind me in 2 hours"
 * clause out of a sentence, leaving the rest for title/time/place.
 */
export function extractReminders(text: string): {
  reminders: ParsedReminderOffset[];
  rest: string;
} {
  const duration =
    "(?:a|an|the|one|two|three|four|five|six|couple(?: of)?|few|several|\\d+)\\s+(?:minutes?|mins?|hours?|hrs?|days?|weeks?)|night|tomorrow";

  const hits: { start: number; end: number; reminder: ParsedReminderOffset }[] = [];

  const patterns: RegExp[] = [
    /(?:with\s+|,\s+|and\s+)?(?:a\s+|an\s+|the\s+)?reminders?\s+(?:for\s+|of\s+)?(.+?)\s+before\b/gi,
    new RegExp(String.raw`remind me\s+(?:in\s+)?(${duration})(?:\s+before)?\b`, "gi"),
    new RegExp(String.raw`\band\s+(?:a\s+|an\s+|the\s+)?(${duration})\s+before\b`, "gi"),
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const body = m[1];
      if (!body) continue;
      const parsed = offsetFromBody(body);
      if (!parsed) continue;
      const start = m.index;
      const end = m.index + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, reminder: parsed });
    }
  }

  hits.sort((a, b) => a.start - b.start);

  const reminders: ParsedReminderOffset[] = [];
  const seen = new Set<number>();
  for (const h of hits) {
    if (seen.has(h.reminder.offsetMinutes)) continue;
    seen.add(h.reminder.offsetMinutes);
    reminders.push(h.reminder);
    if (reminders.length >= MAX_REMINDERS) break;
  }

  let rest = text;
  for (const h of [...hits].sort((a, b) => b.start - a.start)) {
    rest = rest.slice(0, h.start) + " " + rest.slice(h.end);
  }
  // Only a "with" the reminder left dangling ("… with  and …", trailing) goes;
  // "dinner with Sam" keeps its with.
  if (hits.length) rest = rest.replace(/\bwith\s+(?:and\s+)?(?=\s|,|$)|\s+with\s*$/gi, " ");
  rest = rest.replace(/\s{2,}/g, " ").trim();

  return { reminders, rest };
}

export function offsetFromBody(body: string): ParsedReminderOffset | null {
  const b = body
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|the)\s+/, "");
  if (!b) return null;
  if (/\bnight\b/.test(b)) {
    return { offsetMinutes: 12 * 60, label: "Night before" };
  }
  if (/\btomorrow\b/.test(b)) {
    return { offsetMinutes: 24 * 60, label: formatOffsetLabel(24 * 60) };
  }

  const m = b.match(
    /^(?:(one|two|three|four|five|six|couple(?: of)?|few|several|\d+)\s+)?(minutes?|mins?|hours?|hrs?|days?|weeks?)$/
  );
  if (!m) return null;
  const n = parseCount(m[1]);
  if (n == null || n < 1) return null;
  const unit = m[2];
  const mult = unit.startsWith("min")
    ? 1
    : unit.startsWith("hour") || unit.startsWith("hr")
      ? 60
      : unit.startsWith("day")
        ? 1440
        : 10080;
  const offsetMinutes = n * mult;
  if (offsetMinutes < 1 || offsetMinutes > MAX_OFFSET) return null;
  return { offsetMinutes, label: formatOffsetLabel(offsetMinutes) };
}

function parseCount(raw: string | undefined): number | null {
  if (!raw) return 1;
  const key = raw.replace(/\s+of$/, "").trim();
  if (WORD_NUM[key] != null) return WORD_NUM[key];
  const n = parseInt(key, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
