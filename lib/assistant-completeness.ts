import { matchDatePhrase } from "./date-phrase";

/**
 * Did the staged changes keep everything the user said? Models drop details
 * ("dentist next tuesday 3pm at the clinic on main st" lost its location in
 * both audit runs) and sometimes invent them (a 20:30 end nobody gave). This is
 * the deterministic check: every place, clock time and reminder phrase in the
 * message must show up in some staged "add", and when one does not, the model
 * is told exactly what, once.
 *
 * It only judges turns where every staged change is an add. For a move or a
 * delete, a "7pm" in the sentence names the thing being changed, not a value
 * to be written.
 */

export interface StagedAdd {
  kind?: unknown;
  title?: unknown;
  at?: unknown;
  endAt?: unknown;
  allDay?: unknown;
  location?: unknown;
  description?: unknown;
  reminders?: unknown;
  categoryId?: unknown;
  repeatFreq?: unknown;
  until?: unknown;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const UNIT_MINUTES: Record<string, number> = {
  minute: 1,
  min: 1,
  hour: 60,
  hr: 60,
  day: 1440,
  week: 10080,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const STOP = new Set(["the", "a", "an", "at", "in", "on", "of"]);
const words = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => w && !STOP.has(w));

/** "at the clinic on main st" -> "the clinic on main st". */
export function placePhrases(message: string): string[] {
  const out: string[] = [];
  const re =
    /\b(?:at|in|location(?: is)?)\s+((?:the\s+)?[A-Za-z0-9][\w'.&-]*(?:\s+[A-Za-z0-9][\w'.&-]*){0,5})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    let phrase = m[1];
    if (/\bcheck\s*$/i.test(message.slice(0, m.index)) || /^person\b/i.test(phrase)) continue;
    // A clock time or a day is not a place.
    if (
      /^\d/.test(phrase) ||
      /^(?:noon|midnight|night|the morning|the evening|the afternoon)\b/i.test(phrase)
    )
      continue;
    // The place ends where the next clause begins.
    phrase = phrase.split(
      /\s+(?:and|with|remind|reminder|due|for|then|also|before|after|every|until)\b/i,
    )[0];
    // Only phrases that read as a place: "the …" or Capitalised words.
    const placeLike =
      !/^(?:a |an )?(?:minute|hour|day|week|month|year|progress|advance|time|case|person|total|the morning|the afternoon|the evening)\b/i.test(
        phrase,
      );
    // "on Thursday" at the tail is a date, not part of the place.
    phrase = phrase.replace(/\s+on\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i, "");
    if (placeLike && words(phrase).length > 0) out.push(phrase.trim());
  }
  const room = /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+([A-Z]{2,}\s+\d{2,4}[A-Z]?)\s*$/i.exec(
    message,
  );
  if (room && !out.some((place) => norm(place) === norm(room[1]))) out.push(room[1]);
  return out;
}

/** "3pm", "3:30 pm" -> minutes since midnight. Reminder times are skipped. */
export function clockTimes(message: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const before = message.slice(Math.max(0, m.index - 24), m.index);
    // "remind me at 5pm" is a reminder, not the item's time.
    if (/remind(?:er)?s?\b[^.]*$/i.test(before)) continue;
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === "p") h += 12;
    out.push(h * 60 + Number(m[2] ?? 0));
  }
  return out;
}

/** "a day before", "30 minutes before", "2 hours before" -> offset minutes. */
export function reminderOffsets(message: string): number[] {
  const out: number[] = [];
  const re =
    /\b(\d+|an?|one|two|three|four)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\s+(?:before|prior|ahead|early)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
    const unit = m[2].toLowerCase().replace(/s$/, "");
    const per = UNIT_MINUTES[unit];
    if (n && per) out.push(n * per);
  }
  return out;
}

function minutesOfDay(iso: unknown, timeZone: string): number | null {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return (get("hour") % 24) * 60 + get("minute");
  } catch {
    return null;
  }
}

const label = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
};

/** What the message said that no staged add contains. Empty = all kept. */
export function findMissingDetails(
  message: string,
  staged: StagedAdd[],
  timeZone = "UTC",
  now = new Date(),
  categories: { id: string; name: string }[] = [],
): string[] {
  if (!staged.length || staged.some((a) => a.kind !== "create")) return [];
  const missing: string[] = [];

  const haystack = (a: StagedAdd) =>
    norm(
      [a.title, a.location, categories.find((c) => c.id === a.categoryId)?.name]
        .filter((v): v is string => typeof v === "string")
        .join(" "),
    );
  const places = staged.map(haystack);
  for (const phrase of placePhrases(message)) {
    const need = words(phrase);
    const kept = places.some((hay) => {
      const have = new Set(hay.split(" "));
      const hit = need.filter((w) => have.has(w)).length;
      return hit / need.length >= 0.7;
    });
    if (!kept) missing.push(`location "${phrase}"`);
  }

  const have = new Set<number>();
  for (const a of staged) {
    for (const v of [a.at, a.endAt]) {
      const mod = minutesOfDay(v, timeZone);
      if (mod !== null) have.add(mod);
    }
  }
  for (const t of new Set(clockTimes(message))) {
    if (!have.has(t)) missing.push(`time ${label(t)}`);
  }

  // Explicit ranges must survive on the same event, not as two separate adds.
  const first = matchDatePhrase(message, now);
  const tail = first ? message.slice(first.index + first.text.length) : "";
  const second =
    first &&
    !first.end &&
    /^\s*(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|through|thru|until)\b/i.test(tail)
      ? matchDatePhrase(tail, now)
      : null;
  const phrase =
    first && second
      ? {
          ...first,
          end: second.start,
          text: `${first.text}${tail.slice(0, second.index + second.text.length)}`,
        }
      : first;
  if (phrase?.end) {
    const key = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const zoned = (v: unknown) => {
      if (typeof v !== "string" || Number.isNaN(+new Date(v))) return "";
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(v));
    };
    const previousDay = (value: string) => {
      const d = new Date(`${value}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };
    const kept = staged.some((a) => {
      const end = zoned(a.repeatFreq ? a.until : a.endAt);
      if (
        a.repeatFreq &&
        a.endAt &&
        (a.allDay ? previousDay(zoned(a.endAt)) : zoned(a.endAt)) !== zoned(a.at)
      )
        return false;
      return (
        zoned(a.at) === key(phrase.start) &&
        end &&
        (a.allDay && !a.repeatFreq ? previousDay(end) : end) === key(phrase.end!)
      );
    });
    if (!kept) missing.push(`date range "${phrase.text}" on one event`);
  }

  const offsets = new Set<number>();
  for (const a of staged) {
    if (!Array.isArray(a.reminders)) continue;
    for (const r of a.reminders) {
      const n = Number((r as { offsetMinutes?: unknown })?.offsetMinutes);
      if (Number.isFinite(n)) offsets.add(n);
    }
  }
  for (const o of new Set(reminderOffsets(message))) {
    if (!offsets.has(o))
      missing.push(
        `reminder ${o >= 1440 ? `${o / 1440} day(s)` : o >= 60 ? `${o / 60} hour(s)` : `${o} min`} before`,
      );
  }
  return missing;
}

/** The corrective message handed back to the model, once. */
export function correctiveMessage(missing: string[]): string {
  return `Check and correct these possible problems: ${missing.map((detail) => (detail.startsWith("date range") ? `${detail}: the start, end, or year looks wrong; for a repeat use the series start and until, with each occurrence ending on its own day` : `${detail} may be missing`)).join("; ")}. Call the tools again for the complete request, preserving all details.`;
}
