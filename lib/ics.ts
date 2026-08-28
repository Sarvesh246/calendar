// Minimal iCalendar (RFC 5545) reader — enough to import event/assignment feeds
// from Canvas, Google Calendar, Outlook, and similar. Recurring events (RRULE
// DAILY/WEEKLY/MONTHLY) are expanded into concrete instances; VTODO is ignored.
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

interface RawEvent extends IcsEvent {
  rrule?: string;
  exdates: string[];
  recurrenceId?: string;
  cancelled?: boolean;
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

/** Pull the first http(s) link out of a raw value — Canvas often only puts the
 *  assignment link in the HTML DESCRIPTION (`<a href="…">`), not a URL property. */
function extractFirstUrl(value: string): string | undefined {
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(value);
  if (href && /^https?:\/\//i.test(href[1])) return href[1].trim();
  const bare = /https?:\/\/[^\s"'<>)\]]+/i.exec(unescapeText(value));
  return bare ? bare[0].replace(/[.,;]+$/, "") : undefined;
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

type CurEvent = Partial<RawEvent> & { _start?: DateResult; _end?: DateResult };

export function parseIcs(raw: string): ParsedCalendar {
  const lines = unfold(raw);
  let name: string | null = null;
  const rawEvents: RawEvent[] = [];

  let inEvent = false;
  let cur: CurEvent = {};

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name: key, params, value } = parsed;

    if (key === "BEGIN" && value === "VEVENT") {
      inEvent = true;
      cur = { exdates: [] };
      continue;
    }
    if (key === "END" && value === "VEVENT") {
      inEvent = false;
      if (cur.uid && cur.summary && cur._start) {
        rawEvents.push({
          uid: cur.uid,
          summary: cur.summary,
          description: cur.description,
          location: cur.location,
          url: cur.url,
          start: cur._start.iso,
          end: cur._end?.iso,
          allDay: cur._start.allDay,
          rrule: cur.rrule,
          exdates: cur.exdates ?? [],
          recurrenceId: cur.recurrenceId,
          cancelled: cur.cancelled,
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
        if (!cur.url) {
          const found = extractFirstUrl(value);
          if (found) cur.url = found;
        }
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
      case "RRULE":
        cur.rrule = value.trim();
        break;
      case "EXDATE": {
        for (const piece of value.split(",")) {
          const p = parseDate(piece.trim(), params);
          if (p) (cur.exdates ??= []).push(p.iso);
        }
        break;
      }
      case "RECURRENCE-ID": {
        const rec = parseDate(value, params);
        if (rec) cur.recurrenceId = rec.iso;
        break;
      }
      case "STATUS":
        if (/^cancelled$/i.test(value.trim())) cur.cancelled = true;
        break;
    }
  }

  return { name, events: flattenRecurrence(rawEvents) };
}

const WEEKDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_OCCURRENCES = 200;
const HORIZON_MS = 18 * 30 * 24 * 60 * 60 * 1000;

function dayKeyIso(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function parseRRule(raw: string): {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | null;
  interval: number;
  count?: number;
  until?: Date;
  byday: number[] | null;
} {
  const parts: Record<string, string> = {};
  for (const piece of raw.split(";")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    parts[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1).toUpperCase();
  }
  const freqRaw = parts.FREQ;
  const freq =
    freqRaw === "DAILY" || freqRaw === "WEEKLY" || freqRaw === "MONTHLY" ? freqRaw : null;
  const interval = Math.max(1, parseInt(parts.INTERVAL || "1", 10) || 1);
  const count = parts.COUNT ? parseInt(parts.COUNT, 10) : undefined;
  let until: Date | undefined;
  if (parts.UNTIL) {
    const d = parseDate(parts.UNTIL, {});
    if (d) until = new Date(d.iso);
  }
  let byday: number[] | null = null;
  if (parts.BYDAY) {
    byday = parts.BYDAY.split(",")
      .map((tok) => WEEKDAY[tok.replace(/^-?\d+/, "")])
      .filter((n): n is number => n !== undefined);
    if (byday.length === 0) byday = null;
  }
  return { freq, interval, count: Number.isFinite(count) ? count : undefined, until, byday };
}

function addDaysLocal(d: Date, n: number): Date {
  const next = new Date(d.getTime());
  next.setDate(next.getDate() + n);
  return next;
}

function addMonthsLocal(d: Date, n: number): Date {
  const next = new Date(d.getTime());
  const day = next.getDate();
  next.setMonth(next.getMonth() + n, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, last));
  return next;
}

function weeksBetween(a: Date, b: Date): number {
  const ms = startOfLocalWeek(b).getTime() - startOfLocalWeek(a).getTime();
  return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
}

function startOfLocalWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Expand RRULE series into concrete instances. Horizon is ~18 months from now. */
export function expandRRule(
  startIso: string,
  rrule: string,
  exdates: string[] = [],
  horizon = new Date(Date.now() + HORIZON_MS)
): string[] {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return [startIso];
  const rule = parseRRule(rrule);
  if (!rule.freq) return [startIso];
  const until = rule.until && rule.until.getTime() < horizon.getTime() ? rule.until : horizon;
  const exclude = new Set(exdates.map(dayKeyIso));
  const out: string[] = [];
  const max = Math.min(MAX_OCCURRENCES, rule.count ?? MAX_OCCURRENCES);
  let generated = 0;

  const take = (d: Date) => {
    if (d.getTime() > until.getTime()) return false;
    generated += 1;
    if (!exclude.has(dayKeyIso(d.toISOString()))) out.push(d.toISOString());
    return generated < max;
  };

  if (rule.freq === "DAILY") {
    for (let d = new Date(start); generated < max && d.getTime() <= until.getTime(); d = addDaysLocal(d, rule.interval)) {
      if (!take(d)) break;
    }
    return out.length ? out : [startIso];
  }

  if (rule.freq === "WEEKLY") {
    const days = rule.byday ?? [start.getDay()];
    for (
      let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      d.getTime() <= until.getTime() + 86400000;
      d = addDaysLocal(d, 1)
    ) {
      d.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
      if (d.getTime() < start.getTime() - 1000) continue;
      if (!days.includes(d.getDay())) continue;
      if (rule.interval > 1 && weeksBetween(start, d) % rule.interval !== 0) continue;
      if (!take(new Date(d))) break;
    }
    return out.length ? out : [startIso];
  }

  for (let d = new Date(start); generated < max && d.getTime() <= until.getTime(); d = addMonthsLocal(d, rule.interval)) {
    if (!take(d)) break;
  }
  return out.length ? out : [startIso];
}

function flattenRecurrence(raw: RawEvent[]): IcsEvent[] {
  const exceptions = new Map<string, RawEvent>();
  for (const ev of raw) {
    if (ev.recurrenceId) exceptions.set(`${ev.uid}::${dayKeyIso(ev.recurrenceId)}`, ev);
  }

  const toPublic = (ev: RawEvent, start: string, uid: string): IcsEvent => {
    const duration =
      ev.end && ev.start ? new Date(ev.end).getTime() - new Date(ev.start).getTime() : 0;
    const end =
      duration > 0
        ? new Date(new Date(start).getTime() + duration).toISOString()
        : ev.end && start === ev.start
          ? ev.end
          : undefined;
    return {
      uid,
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
      url: ev.url,
      start,
      end,
      allDay: ev.allDay,
    };
  };

  const out: IcsEvent[] = [];
  for (const ev of raw) {
    if (ev.cancelled && !ev.recurrenceId) continue;
    if (ev.recurrenceId) {
      if (ev.cancelled) continue;
      out.push(toPublic(ev, ev.start, `${ev.uid}::${dayKeyIso(ev.recurrenceId)}`));
      continue;
    }
    if (!ev.rrule) {
      out.push(toPublic(ev, ev.start, ev.uid));
      continue;
    }
    const starts = expandRRule(ev.start, ev.rrule, ev.exdates);
    for (const start of starts) {
      const exKey = `${ev.uid}::${dayKeyIso(start)}`;
      if (exceptions.has(exKey)) continue;
      out.push(toPublic(ev, start, `${ev.uid}::${dayKeyIso(start)}`));
    }
  }
  return out;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function dateStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Build a vCalendar from local items (one VEVENT each — recurrences already expanded). */
export function serializeIcs(
  items: {
    id: string;
    title: string;
    at: string;
    endAt?: string;
    allDay?: boolean;
    description?: string;
    location?: string;
    url?: string;
    sourceUid?: string;
  }[],
  calendarName = "Datebook"
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Datebook//EN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
    "CALSCALE:GREGORIAN",
  ];
  const now = utcStamp(new Date());
  for (const item of items) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${(item.sourceUid || item.id).replace(/\s/g, "")}@datebook`);
    lines.push(`DTSTAMP:${now}`);
    if (item.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(item.at)}`);
      if (item.endAt) lines.push(`DTEND;VALUE=DATE:${dateStamp(item.endAt)}`);
    } else {
      lines.push(`DTSTART:${utcStamp(new Date(item.at))}`);
      if (item.endAt) lines.push(`DTEND:${utcStamp(new Date(item.endAt))}`);
    }
    lines.push(`SUMMARY:${icsEscape(item.title)}`);
    if (item.description) lines.push(`DESCRIPTION:${icsEscape(item.description)}`);
    if (item.location) lines.push(`LOCATION:${icsEscape(item.location)}`);
    if (item.url) lines.push(`URL:${item.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
