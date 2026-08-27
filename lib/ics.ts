// Minimal iCalendar (RFC 5545) reader — enough to import event/assignment feeds
// from Canvas, Google Calendar, Outlook, and similar. It deliberately ignores
// recurrence (RRULE), VTODO, and VTIMEZONE: Canvas assignment feeds emit one
// VEVENT per due date, which is the case that matters here.
//
// Pure module — no Node or browser APIs — so the API route (server) and the
// settings UI (client, type-only) can both import it.

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** ISO datetime string. */
  start: string;
  /** ISO datetime string, when the feed provides DTEND. */
  end?: string;
  allDay: boolean;
}

export interface ParsedCalendar {
  name: string | null;
  events: IcsEvent[];
}

/** Undo RFC 5545 line folding: continuation lines begin with a space or tab. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** Split "DTSTART;TZID=America/New_York:20260901T235900" into name, params, value. */
function parseLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(";");
  const name = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq !== -1) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
  }
  return { name, params, value };
}

/** Unescape a TEXT value: \n \, \; \\ per RFC 5545. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Crudely turn an HTML-ish description into readable plain text. */
function toPlainText(value: string): string {
  const text = unescapeText(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 2000 ? text.slice(0, 2000).trimEnd() + "…" : text;
}

interface DateResult {
  iso: string;
  allDay: boolean;
}

function parseDate(value: string, params: Record<string, string>): DateResult | null {
  const v = value.trim();

  // Date only: 20260902 → an all-day entry. Anchor at local noon so it stays on
  // the same calendar day regardless of the viewer's timezone.
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || params.VALUE === "DATE") {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return isNaN(d.getTime()) ? null : { iso: d.toISOString(), allDay: true };
  }

  // UTC: 20260901T235900Z
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  if (utc) {
    const [, y, mo, d, h, mi, s] = utc;
    const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    return isNaN(ms) ? null : { iso: new Date(ms).toISOString(), allDay: false };
  }

  // Local / floating (optionally with a TZID we can't resolve without a tz
  // database): 20260901T235900 — interpret in the viewer's local zone.
  const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (local) {
    const [, y, mo, d, h, mi, s] = local;
    const dt = new Date(+y, +mo - 1, +d, +h, +mi, +s);
    return isNaN(dt.getTime()) ? null : { iso: dt.toISOString(), allDay: false };
  }

  const fallback = new Date(v);
  return isNaN(fallback.getTime()) ? null : { iso: fallback.toISOString(), allDay: false };
}

export function parseIcs(raw: string): ParsedCalendar {
  const lines = unfold(raw);
  let name: string | null = null;
  const events: IcsEvent[] = [];

  let inEvent = false;
  let cur: Partial<IcsEvent> & { _start?: DateResult; _end?: DateResult } = {};

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name: key, params, value } = parsed;

    if (key === "BEGIN" && value === "VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (key === "END" && value === "VEVENT") {
      inEvent = false;
      if (cur.uid && cur.summary && cur._start) {
        events.push({
          uid: cur.uid,
          summary: cur.summary,
          description: cur.description,
          location: cur.location,
          url: cur.url,
          start: cur._start.iso,
          end: cur._end?.iso,
          allDay: cur._start.allDay,
        });
      }
      continue;
    }

    if (!inEvent) {
      if (key === "X-WR-CALNAME") name = unescapeText(value).trim() || null;
      continue;
    }

    switch (key) {
      case "UID":
        cur.uid = value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(value).trim();
        break;
      case "DESCRIPTION": {
        const text = toPlainText(value);
        if (text) cur.description = text;
        break;
      }
      case "LOCATION": {
        const loc = unescapeText(value).trim();
        if (loc) cur.location = loc;
        break;
      }
      case "URL":
        if (value.trim()) cur.url = value.trim();
        break;
      case "DTSTART":
        cur._start = parseDate(value, params) ?? undefined;
        break;
      case "DTEND":
        cur._end = parseDate(value, params) ?? undefined;
        break;
    }
  }

  return { name, events };
}
