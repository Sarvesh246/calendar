/**
 * Local-first assistant. Most of what people ask a calendar assistant on a
 * normal day — "what's on tomorrow", "mark my essay done", "push the lab to
 * Friday", "when's my next class" — is a lookup or a one-item edit over data
 * that is already on this device. Sending it to a model spends quota (and a
 * network round trip) to compute something we can compute exactly.
 *
 * The contract that keeps this honest: `tryLocalAnswer` answers only when it is
 * *confident* and returns `null` for everything else, and null goes to the
 * model. It never guesses a target, never invents an item, and never claims
 * something is absent unless it searched for exactly that. Replies are written
 * in the assistant's voice (short, bold titles/times, no chips), so the user
 * cannot tell which path produced them.
 */
import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  format,
  isSameDay,
  startOfDay,
} from "date-fns";
import type { AssistantAction, AssistantCtx, AssistantResponse, AssistantTurn } from "./ai-assistant";
import { toNewItem } from "./bulk-parse";
import { formatMeetingSummary, isClassMeeting, savedClassMeetings } from "./class-schedule";
import { matchDatePhrase } from "./date-phrase";
import {
  happeningNow,
  isDueOnDay,
  isEventEnded,
  isOverdueAt,
  itemOccupiesDay,
  thisOrNextWeekday,
} from "./date-utils";
import { parseMultiAdd } from "./multi-add";
import { nanoid } from "./nanoid";
import { parseQuickAdd } from "./quick-add-parser";
import { formatOffsetLabel } from "./reminder-defaults";
import { answerHelpQuestion } from "./local-help";
import { answerSyllabusQuestion } from "./local-syllabus";
import type { Category, Item, ItemStatus, RepeatRule } from "./types";

type Env = {
  ctx: AssistantCtx;
  now: Date;
  /** Original text, trimmed. */
  raw: string;
  /** Politeness stripped, original case. */
  n: string;
  /** `n`, lowercased with contractions expanded — what patterns match against. */
  q: string;
  history: AssistantTurn[];
};

/** `undefined` = not my intent; `null` = my intent but not confident, ask the model. */
type Outcome = AssistantResponse | null | undefined;

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const LEAD_FILLER = /^(?:hey|hi|hello|yo|ok(?:ay)?|so|um+|uh+|well|please|pls|plz|datebook|assistant|and|also|actually|alright|right)[,!.\s]+/i;
const TAIL_FILLER = /[\s,]*(?:please|pls|plz|for me|real quick|thanks|thank you|thx|ty|if you can|when you can)[.!\s]*$/i;

function normalize(raw: string): string {
  let t = raw.trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  while (LEAD_FILLER.test(t)) t = t.replace(LEAD_FILLER, "");
  t = t
    .replace(/^(?:can|could|would|will) (?:you|u) (?:please |pls )?/i, "")
    .replace(/^(?:i(?:'d| would) like (?:you )?to|i need (?:you )?to|i want (?:you )?to|i wanna|let'?s|go ahead and|help me|i'?d like to)\s+/i, "")
    .replace(/^(?:tell me|show me|let me know|give me|do you know|i(?:'m| am) (?:wondering|curious)(?: about)?|i want to know|i need to know|i wonder)\s+/i, "");
  t = t.replace(TAIL_FILLER, "").replace(/[?!.]+$/, "").trim();
  return t;
}

function expand(q: string): string {
  return q
    .toLowerCase()
    .replace(/\b(what|when|where|who|how|there|that|here|it)'s\b/g, "$1 is")
    .replace(/\bwhats\b/g, "what is")
    .replace(/\bhows\b/g, "how is")
    .replace(/\bwhens\b/g, "when is")
    .replace(/\bwheres\b/g, "where is")
    .replace(/\bi'm\b/g, "i am")
    .replace(/\bi've\b/g, "i have")
    .replace(/\bdon't\b/g, "do not")
    .replace(/\bdoesn't\b/g, "does not")
    .replace(/\btmrw\b|\btmr\b|\b2moro\b|\btmw\b/g, "tomorrow")
    .replace(/\bassignments\b/g, "assignments")
    .replace(/\s+/g, " ")
    .trim();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function pick<T>(seed: string, options: T[]): T {
  return options[hash(seed) % options.length];
}

const bold = (s: string) => `**${s}**`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ */
/* Dates and times                                                     */
/* ------------------------------------------------------------------ */

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const WEEKDAY_FULL = /\b(?:(this|next|last|coming|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/;
const WEEKDAY_SHORT = /\b(?:(this|next|last|on|by|before|until|till|through)\s+)(sun|mon|tues?|weds?|thu(?:rs?)?|fri|sat)\b/;

function prevWeekday(dow: number, from: Date): Date {
  let d = addDays(startOfDay(from), -1);
  while (d.getDay() !== dow) d = addDays(d, -1);
  return d;
}

function fmtTime(d: Date | string, clock24h: boolean): string {
  return format(typeof d === "string" ? new Date(d) : d, clock24h ? "HH:mm" : "h:mm a");
}

function dayName(d: Date, now: Date): string {
  const diff = differenceInCalendarDays(startOfDay(d), startOfDay(now));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return format(d, "EEE, MMM d");
}

function longDay(d: Date, now: Date): string {
  const diff = differenceInCalendarDays(startOfDay(d), startOfDay(now));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return format(d, "EEEE, MMM d");
}

function relative(d: Date, now: Date): string {
  const days = differenceInCalendarDays(startOfDay(d), startOfDay(now));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function untilPhrase(target: Date, now: Date): string | null {
  const mins = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (mins <= 0 || mins >= 24 * 60) return null;
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 6) / 10;
  return `in ${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}`;
}

type DayRef =
  | { kind: "day"; day: Date; label: string; text: string; evening?: boolean }
  | { kind: "range"; start: Date; end: Date; label: string; text: string };

const ORDINAL_DAY = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/;

/** Find the first day or span of days the sentence talks about. `end` is exclusive. */
function findDayRef(qIn: string, now: Date): DayRef | null {
  // A lone "sat" / "fri" — the whole answer to "move it to …" — is unambiguous.
  const q = WEEKDAY_INDEX[qIn.trim()] !== undefined && qIn.trim().length <= 5 ? `on ${qIn.trim()}` : qIn;
  const today = startOfDay(now);
  const day = (d: Date, label: string, text: string, evening?: boolean): DayRef => ({ kind: "day", day: d, label, text, evening });
  let m: RegExpExecArray | null;

  if ((m = /\bday after tomorrow\b/.exec(q))) return day(addDays(today, 2), format(addDays(today, 2), "EEEE"), m[0]);
  if ((m = /\btomorrow(?:\s+(?:morning|afternoon|evening|night))?\b/.exec(q))) return day(addDays(today, 1), "tomorrow", m[0]);
  if ((m = /\b(?:tonight|this evening)\b/.exec(q))) return day(today, "tonight", m[0], true);
  if ((m = /\b(?:today|this morning|this afternoon|right now)\b/.exec(q))) return day(today, "today", m[0]);
  if ((m = /\b(?:yesterday|last night)\b/.exec(q))) return day(addDays(today, -1), "yesterday", m[0]);

  if ((m = /\b(?:this|the coming|next)\s+weekend\b/.exec(q))) {
    let sat = thisOrNextWeekday(6, today);
    if (/next/.test(m[0]) && differenceInCalendarDays(sat, today) < 7) sat = addDays(sat, 7);
    if (today.getDay() === 0 && !/next/.test(m[0])) sat = addDays(today, -1);
    return { kind: "range", start: sat, end: addDays(sat, 2), label: /next/.test(m[0]) ? "next weekend" : "this weekend", text: m[0] };
  }
  if ((m = /\b(?:the )?rest of (?:the|this) week\b/.exec(q))) {
    const toSat = (6 - today.getDay() + 7) % 7;
    return { kind: "range", start: today, end: addDays(today, toSat + 1), label: "the rest of this week", text: m[0] };
  }
  if ((m = /\blast week\b/.exec(q))) {
    const start = addDays(today, -today.getDay() - 7);
    return { kind: "range", start, end: addDays(start, 7), label: "last week", text: m[0] };
  }
  if ((m = /\b(this|the|next|last) month\b/.exec(q))) {
    const which = m[1];
    const offset = which === "next" ? 1 : which === "last" ? -1 : 0;
    const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { kind: "range", start, end, label: which === "next" ? "next month" : which === "last" ? "last month" : "this month", text: m[0] };
  }
  if ((m = /\bnext week\b/.exec(q))) {
    const start = addDays(today, 7 - today.getDay());
    return { kind: "range", start, end: addDays(start, 7), label: "next week", text: m[0] };
  }
  if ((m = /\b(?:this|the|my) week\b/.exec(q)) && !/\bweek(?:s)? (?:ago|from)\b/.test(q)) {
    return { kind: "range", start: today, end: addDays(today, 7 - today.getDay()), label: "this week", text: m[0] };
  }
  if ((m = /\b(?:in )?the next (\d{1,2}|few|couple of) days\b/.exec(q))) {
    const n = /few/.test(m[1]) ? 3 : /couple/.test(m[1]) ? 2 : Math.min(14, Math.max(1, +m[1]));
    return { kind: "range", start: today, end: addDays(today, n), label: `the next ${n} days`, text: m[0] };
  }

  const full = WEEKDAY_FULL.exec(q);
  const short = full ? null : WEEKDAY_SHORT.exec(q);
  const wd = full ?? short;
  if (wd) {
    const dow = WEEKDAY_INDEX[wd[2]];
    const mod = wd[1];
    let d = thisOrNextWeekday(dow as 0, today);
    if (mod === "next") d = addDays(today, 7 - today.getDay() + dow);
    if (mod === "last") d = prevWeekday(dow, today);
    return day(d, mod === "next" || mod === "last" ? `${mod} ${format(d, "EEEE")}` : format(d, "EEEE"), wd[0]);
  }

  const phrase = matchDatePhrase(q, now);
  if (phrase) {
    if (phrase.end) return { kind: "range", start: phrase.start, end: addDays(phrase.end, 1), label: `${format(phrase.start, "MMM d")}–${format(phrase.end, "MMM d")}`, text: phrase.text };
    return day(phrase.start, format(phrase.start, "EEEE, MMM d"), phrase.text);
  }
  if ((m = ORDINAL_DAY.exec(q))) {
    const dom = +m[1];
    for (const offset of [0, 1]) {
      const cand = new Date(today.getFullYear(), today.getMonth() + offset, dom);
      if (cand.getDate() === dom && cand >= today) return day(startOfDay(cand), format(cand, "EEEE, MMM d"), m[0]);
    }
  }
  return null;
}

type TimeRef = { h: number; m: number; text: string; explicit: boolean };

/** "3pm", "3:30 pm", "at 15:00", "noon". Bare "at 8" is read as a sensible daytime hour. */
function findTime(q: string): TimeRef | null {
  let m: RegExpExecArray | null;
  if ((m = /\bnoon\b/.exec(q))) return { h: 12, m: 0, text: m[0], explicit: true };
  if ((m = /\bmidnight\b/.exec(q))) return { h: 23, m: 59, text: m[0], explicit: true };
  if ((m = /(?:\b(?:at|around|by|@)\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/.exec(q))) {
    let h = +m[1] % 12;
    if (/^p/.test(m[3])) h += 12;
    if (+m[1] > 12 || (m[2] && +m[2] > 59)) return null;
    return { h, m: m[2] ? +m[2] : 0, text: m[0], explicit: true };
  }
  if ((m = /\b(?:at|@)\s*(\d{1,2}):(\d{2})\b/.exec(q)) || (m = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(q))) {
    return { h: +m[1], m: +m[2], text: m[0], explicit: true };
  }
  if ((m = /\b(?:at|@|around)\s*(\d{1,2})\b(?!\s*(?:st|nd|rd|th|days?|weeks?|hours?|mins?|minutes?))/.exec(q))) {
    const h = +m[1];
    if (h < 1 || h > 12) return null;
    return { h: h >= 7 && h <= 11 ? h : h === 12 ? 12 : h + 12, m: 0, text: m[0], explicit: false };
  }
  return null;
}

function atTime(day: Date, t: { h: number; m: number }): Date {
  const d = startOfDay(day);
  d.setHours(t.h, t.m, 0, 0);
  return d;
}

/* ------------------------------------------------------------------ */
/* Finding things                                                      */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  "the", "my", "a", "an", "of", "for", "to", "on", "in", "at", "and", "with", "this", "that", "these",
  "those", "our", "your", "me", "i", "is", "are", "do", "does", "when", "what", "any", "some", "all",
  "up", "next", "its", "from", "by", "about", "be", "it", "one", "there", "have", "has", "was", "will",
]);
const SOFT = new Set(["class", "classes", "lecture", "lectures", "meeting", "meetings", "event", "events", "appointment", "appointments", "assignment", "assignments", "task", "tasks"]);
const SYNONYM: Record<string, string> = { hw: "homework", proj: "project", pset: "pset", prob: "problem", mtg: "meeting", appt: "appointment" };

function spaceAlnum(s: string): string {
  return s.replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
}

function stem(t: string): string {
  if (/^\d+$/.test(t) || t.length <= 3) return t;
  if (t.endsWith("ies")) return `${t.slice(0, -3)}y`;
  if (t.endsWith("ss")) return t;
  return t.endsWith("s") ? t.slice(0, -1) : t;
}

function tokens(s: string): string[] {
  return spaceAlnum(s.toLowerCase().replace(/[^a-z0-9\s]/g, " "))
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t))
    .flatMap((t) => (t === "ps" || t === "pset" ? ["problem", "set"] : [stem(SYNONYM[t] ?? t)]));
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

function tokenMatches(want: string, have: string[]): boolean {
  const numeric = /^\d+$/.test(want);
  return have.some((h) => {
    if (h === want) return true;
    if (numeric || /^\d+$/.test(h)) return false;
    if (want.length >= 3 && h.startsWith(want)) return true;
    return want.length >= 5 && h.length >= 5 && editDistanceAtMost1(want, h);
  });
}

function categoryOf(env: Env, item: Item): Category | undefined {
  return env.ctx.categories.find((c) => c.id === item.categoryId);
}

function categoryTokens(c: Category | undefined): string[] {
  return c ? tokens(`${c.name} ${c.classTitle ?? ""}`) : [];
}

/** A class the sentence names outright ("for cs 101", "in econ"). */
function findClass(env: Env, q: string): Category | undefined {
  const text = ` ${spaceAlnum(q.replace(/[^a-z0-9\s]/g, " "))} `;
  let best: { c: Category; len: number } | undefined;
  for (const c of env.ctx.categories) {
    if (c.archived) continue;
    const words = c.name.split(/\s+/).filter(Boolean);
    const names = [c.name, c.classTitle, words.length > 1 ? words.map((w) => w[0]).join("") : undefined].filter((v): v is string => Boolean(v));
    for (const name of names) {
      const needle = ` ${spaceAlnum(name.toLowerCase().replace(/[^a-z0-9\s]/g, " ")).replace(/\s+/g, " ").trim()} `;
      if (needle.trim().length >= 2 && text.includes(needle) && (!best || needle.length > best.len)) best = { c, len: needle.length };
    }
  }
  return best?.c;
}

function seriesKey(i: Item): string {
  return `${i.title.trim().toLowerCase()}|${i.repeatId ?? ""}|${i.categoryId}`;
}

type Scope = "open-work" | "done-work" | "any" | "editable";
type Target =
  | { kind: "one"; item: Item; series: number }
  | { kind: "many"; items: Item[] }
  | { kind: "none" };

/**
 * Turn "the essay", "my 3pm class tomorrow", "cs 101 hw 3" into one item — or
 * say plainly that it is several, or that we can't tell. Anything short of one
 * clear winner is left for the caller to hand to the model.
 */
function resolveTarget(env: Env, phraseRaw: string, scope: Scope): Target {
  const { now } = env;
  let phrase = expand(phraseRaw);
  const dayRef = findDayRef(phrase, now);
  if (dayRef) phrase = phrase.replace(dayRef.text, " ");
  const time = findTime(phrase);
  if (time) phrase = phrase.replace(time.text, " ");
  phrase = phrase.replace(/\b(?:on|for|due|starting|scheduled|coming)\b\s*$/g, " ");
  const want = tokens(phrase).filter((t) => !["due", "scheduled"].includes(t));
  if (!want.length) return { kind: "none" };
  const hard = want.filter((t) => !SOFT.has(t) && !SOFT.has(`${t}s`));
  const soft = want.filter((t) => SOFT.has(t) || SOFT.has(`${t}s`));
  if (!hard.length && !soft.length) return { kind: "none" };
  if (!hard.length && !dayRef && !time) return { kind: "none" };

  const softOk = (item: Item, t: string): boolean => {
    if (/^(?:class|lecture)$/.test(t)) return isClassMeeting(item, categoryOf(env, item)?.name);
    if (/^(?:meeting|event|appointment)$/.test(t)) return item.type === "event";
    if (t === "assignment") return item.type === "assignment";
    if (t === "task") return item.type === "task";
    return false;
  };

  type Scored = { item: Item; tier: number };
  const scored: Scored[] = [];
  for (const item of env.ctx.items) {
    if (scope === "open-work" && (item.type === "event" || item.status === "done")) continue;
    if (scope === "done-work" && (item.type === "event" || item.status !== "done")) continue;
    const title = tokens(item.title);
    const hay = [...title, ...categoryTokens(categoryOf(env, item))];
    if (!hard.every((t) => tokenMatches(t, hay))) continue;
    const inTitle = hard.every((t) => tokenMatches(t, title));
    if (!soft.every((t) => tokenMatches(t, title) || softOk(item, t))) continue;
    if (dayRef?.kind === "day") {
      const onDay = item.type === "event" ? itemOccupiesDay(item, dayRef.day) : isDueOnDay(item, dayRef.day);
      if (!onDay) continue;
    }
    if (dayRef?.kind === "range") {
      const at = new Date(item.at);
      if (at < dayRef.start || at >= dayRef.end) continue;
    }
    if (time) {
      const at = new Date(item.at);
      if (at.getHours() !== time.h || at.getMinutes() !== time.m) continue;
    }
    const exact = hard.length >= title.length && title.length > 0 && inTitle;
    scored.push({ item, tier: exact ? 0 : inTitle ? 1 : 2 });
  }
  if (!scored.length) return { kind: "none" };

  const bestTier = Math.min(...scored.map((s) => s.tier));
  const pool = scored.filter((s) => s.tier === bestTier).map((s) => s.item);

  // A weekly class is dozens of identical rows: keep the next one that hasn't ended.
  const groups = new Map<string, Item[]>();
  for (const item of pool) {
    const k = seriesKey(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  const reps: Array<{ item: Item; series: number }> = [];
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const upcoming = sorted.find((i) => (i.type === "event" ? !isEventEnded(i, now, new Date(i.at)) || +new Date(i.at) >= +now : +new Date(i.at) >= +startOfDay(now)));
    const overdueOpen = sorted.find((i) => i.type !== "event" && i.status !== "done");
    reps.push({ item: upcoming ?? overdueOpen ?? sorted[sorted.length - 1], series: list.length });
  }
  if (reps.length === 1) return { kind: "one", item: reps[0].item, series: reps[0].series };
  reps.sort((a, b) => +new Date(a.item.at) - +new Date(b.item.at));
  return { kind: "many", items: reps.map((r) => r.item) };
}

function describeWhen(env: Env, item: Item): string {
  const d = new Date(item.at);
  const time = item.allDay || (item.type !== "event" && d.getHours() === 23 && d.getMinutes() === 59) ? "" : ` at ${fmtTime(d, env.ctx.clock24h)}`;
  return `${dayName(d, env.now)}${time}`;
}

type Build = (item: Item, series: number) => AssistantResponse | null;

/**
 * The last "which one?" we asked, and what to do once the user picks. Lives in
 * memory for this tab only: a reload drops it and the reply goes to the model.
 */
let pendingChoice: { prompt: string; options: Item[]; build: Build } | null = null;
/** We asked "what do you want to know?" about a class's syllabus; the reply is the topic. */
let pendingSyllabus: { prompt: string; className: string } | null = null;

/** For tests: forget any half-finished "which one?" exchange. */
export function resetLocalAssistantState() {
  pendingChoice = null;
  pendingSyllabus = null;
}

/** Ask which of a few matches was meant; more than a handful is the model's job. */
function askWhich(env: Env, items: Item[], build?: Build): AssistantResponse | null {
  if (items.length > 4) return null;
  const options = items.map((i) => `${bold(i.title)} (${describeWhen(env, i)})`);
  const last = options.pop();
  const text = `Which one do you mean — ${options.length ? `${options.join(", ")} or ${last}` : last}?`;
  if (build) pendingChoice = { prompt: text, options: items, build };
  return { text };
}

const ORDINALS: Record<string, number> = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, fourth: 3, "4th": 3, four: 3 };

/** "the second one", "problem set 4", "the one on friday" → one of the options. */
function pickOption(env: Env, options: Item[]): Item | null {
  const q = env.q.replace(/^(?:the|um|uh|oh|i meant|i mean|mean)\s+/g, "").trim();
  if (/^(?:neither|none|nevermind|never mind|cancel|forget it|no)\b/.test(q)) return null;
  const titleHits = options.filter((o) => {
    const want = tokens(q.replace(/\b(?:one|the|on|due)\b/g, " "));
    const have = [...tokens(o.title), ...tokens(format(new Date(o.at), "EEEE MMM d"))];
    return want.length > 0 && want.every((w) => tokenMatches(w, have) || (/^\d+$/.test(w) && have.includes(w)));
  });
  if (titleHits.length === 1) return titleHits[0];
  const dayRef = findDayRef(q, env.now);
  if (dayRef?.kind === "day") {
    const onDay = options.filter((o) => isSameDay(new Date(o.at), dayRef.day));
    if (onDay.length === 1) return onDay[0];
  }
  if (/^(?:last|the last|latter|the latter)(?: one)?$/.test(q)) return options[options.length - 1];
  if (/^(?:former|the former)(?: one)?$/.test(q)) return options[0];
  const ord = /^(first|1st|second|2nd|third|3rd|fourth|4th|one|two|three|four)(?: one)?$/.exec(q) ?? /^#?([1-4])$/.exec(q);
  if (ord) {
    const idx = /^\d$/.test(ord[1]) ? +ord[1] - 1 : ORDINALS[ord[1]];
    // A bare number that is also in a title ("4" → "Problem Set 4") was handled above.
    if (idx >= 0 && idx < options.length) return options[idx];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Small talk                                                          */
/* ------------------------------------------------------------------ */

function smallTalk(env: Env): Outcome {
  const { q, now, ctx } = env;
  const seed = `${q}|${now.getMinutes()}`;
  if (/^(?:hi|hello|hey|yo|sup|hiya|howdy|good (?:morning|afternoon|evening))(?: there| datebook)?$/.test(q)) {
    return { text: pick(seed, [
      "Hey! Ask me about your schedule, or tell me what to add, move, or finish.",
      "Hi there — what can I help you with?",
      "Hey. What are we tackling today?",
    ]) };
  }
  if (/^(?:thanks|thank you|thank you so much|thx|ty|cheers|much appreciated|appreciate it|thanks a lot|thanks so much)$/.test(q)) {
    return { text: pick(seed, ["You're welcome!", "Anytime.", "Happy to help."]) };
  }
  if (/^(?:ok|okay|cool|great|nice|perfect|awesome|got it|sounds good|sweet|alright|k|kk|good|love it|fair enough|makes sense)$/.test(q)) {
    return { text: pick(seed, ["Sounds good. Let me know if you need anything else.", "Great — I'm here if anything comes up.", "Perfect."]) };
  }
  if (/^(?:bye|goodbye|see you|see ya|good night|goodnight|later|talk later|cya)$/.test(q)) {
    return { text: pick(seed, ["See you later!", "Take care — I'll be here.", "Good luck out there."]) };
  }
  if (/^(?:how are you|how are you doing|how is it going|how are things|what is up)$/.test(q)) {
    return { text: "Doing well, thanks. What can I help you with on your calendar?" };
  }
  if (/^(?:what can you do|help|what do you do|how do you work|what can i ask(?: you)?|what can i say|how can you help|what are your features|commands)$/.test(q)) {
    return { text: "I can answer questions about your calendar — what's on a day, what's due, when you're free, when a class meets — and make changes for you: add, move, rename, complete, or delete items. Just say it however you'd say it to a person, and I'll ask you to confirm before anything changes." };
  }
  if (/^(?:who are you|what are you)$/.test(q)) {
    return { text: "I'm Datebook's assistant — I help you check your schedule and keep it up to date." };
  }
  if (/^(?:what time is it(?: now| right now)?|what is the time|current time|time)$/.test(q)) {
    return { text: `It's ${bold(fmtTime(now, ctx.clock24h))}.` };
  }
  if (/^(?:what day is it(?: today)?|what is (?:the )?date(?: today)?|what is today'?s date|what is today|what date is it|date|today'?s date)$/.test(q)) {
    return { text: `It's ${bold(format(now, "EEEE, MMMM d"))}.` };
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

const PRONOUN_ONLY = /^(?:it|that|this|them|those|these|that one|this one|the same|same)$/;

function update(item: Item, summary: string, patch: Partial<Item>): AssistantAction {
  return { kind: "update", summary, itemId: item.id, itemTitle: item.title, patch };
}

function statusAction(item: Item, status: ItemStatus): AssistantAction {
  const verb = status === "done" ? "done" : status === "doing" ? "in progress" : "to do";
  return update(item, `Mark “${item.title}” ${verb}`, { status });
}

function statusFor(item: Item, status: ItemStatus): AssistantResponse | null {
  if (item.type === "event") return null;
  const current = item.status ?? "todo";
  if (current === status) {
    return { text: `${bold(item.title)} is already ${status === "doing" ? "in progress" : status === "done" ? "done" : "on your to-do list"}.` };
  }
  const text =
    status === "done"
      ? pick(item.title, [`I'll mark ${bold(item.title)} as done. Confirm below.`, `Marking ${bold(item.title)} done — confirm below and it's checked off.`])
      : status === "doing"
        ? `I'll mark ${bold(item.title)} as in progress. Confirm below.`
        : `I'll reopen ${bold(item.title)}. Confirm below.`;
  return { text, actions: [statusAction(item, status)] };
}

function setStatus(env: Env, phrase: string, status: ItemStatus): Outcome {
  const p = phrase.trim();
  if (!p || PRONOUN_ONLY.test(p)) return null;
  const scope: Scope = status === "done" ? "open-work" : status === "todo" ? "done-work" : "open-work";
  if (isBulk(p)) {
    const items = selectBulk(env, p, status === "todo" ? "reopen" : "done");
    if (!items) return null;
    return bulkResponse(env, p, items, status === "done" ? "mark done" : status === "doing" ? "mark in progress" : "reopen", (i) => statusAction(i, status));
  }
  const several = resolveSeveral(env, p, scope);
  if (several) {
    if (several.length > 12) return null;
    const actions = several.map((i) => statusAction(i, status));
    const verb = status === "done" ? "mark" : status === "doing" ? "start" : "reopen";
    const tail = status === "done" ? " as done" : status === "doing" ? "" : "";
    return { text: `I'll ${verb} ${joinNatural(several.map((i) => bold(i.title)))}${tail}. Confirm below.`, actions };
  }
  let target = resolveTarget(env, p, scope);
  if (target.kind === "none") {
    // "Already done" is worth saying rather than looking like a miss.
    const done = resolveTarget(env, p, status === "todo" ? "open-work" : "done-work");
    if (done.kind === "one" && done.item.type !== "event") {
      const s = done.item.status ?? "todo";
      if (status === "done" && s === "done") return { text: `${bold(done.item.title)} is already marked done.` };
      if (status === "todo" && s !== "done") return { text: `${bold(done.item.title)} isn't marked done, so there's nothing to reopen.` };
    }
    target = { kind: "none" };
  }
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items, (item) => statusFor(item, status));
  return statusFor(target.item, status);
}

/* ------------------------------------------------------------------ */
/* Several things at once                                              */
/* ------------------------------------------------------------------ */

const BULK_WORD = /\b(?:everything|all(?![- ]day)|every(?!\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)|each|both)\b/;

function isBulk(phrase: string): boolean {
  return BULK_WORD.test(expand(phrase));
}

const BULK_FILLER = new Set([
  "all", "everything", "every", "each", "both", "my", "the", "due", "on", "for", "in", "from", "of", "that", "which", "is", "are",
  "i", "have", "as", "thing", "item", "stuff", "assignment", "homework", "task", "todo", "event", "meeting", "class", "lecture",
  "overdue", "late", "past", "completed", "complete", "done", "finished", "checked", "off", "open", "remaining", "left",
  "outstanding", "incomplete", "unfinished", "upcoming", "scheduled", "this", "next", "last", "today", "tomorrow", "week", "weekend",
  "month", "tonight", "them", "those", "these", "back", "forward", "to", "until",
]);

type BulkPurpose = "done" | "reopen" | "delete" | "move";

/**
 * "everything due friday", "all my overdue econ homework", "all completed
 * tasks" → the items it means, or null when the phrase is not narrowed enough
 * to act on safely ("delete everything") or has words we don't understand.
 */
function selectBulk(env: Env, phraseIn: string, purpose: BulkPurpose): Item[] | null {
  const { now } = env;
  let p = expand(phraseIn);
  const ref = findDayRef(p, now);
  if (ref) p = p.replace(ref.text, " ");
  const cls = findClass(env, p);
  const overdue = /\b(?:overdue|late|past due)\b/.test(p);
  const done = /\b(?:completed|done|finished|checked off)\b/.test(p) && purpose !== "done";
  const kind = /\b(?:assignments?|homework|hw)\b/.test(p)
    ? "assignment"
    : /\b(?:tasks?|to-?dos?)\b/.test(p)
      ? "task"
      : /\b(?:classes|lectures?)\b/.test(p)
        ? "class"
        : /\b(?:events?|meetings?|appointments?)\b/.test(p)
          ? "event"
          : undefined;
  if (!ref && !cls && !overdue && !done) return null;
  const dueOnly = /\bdue\b/.test(p) && !kind;
  const clsWords = new Set(categoryTokens(cls));
  const leftover = tokens(p).filter((t) => !BULK_FILLER.has(t) && !clsWords.has(t));
  if (leftover.length) return null;

  let items = env.ctx.items.filter((i) => {
    if (kind === "class") return isClass(env, i);
    if (kind === "event") return i.type === "event";
    if (kind) return i.type === kind;
    return true;
  });
  if (dueOnly) items = items.filter(isWork);
  if (purpose === "done") items = items.filter(isOpen);
  if (purpose === "reopen") items = items.filter((i) => isWork(i) && i.status === "done");
  if (purpose === "move") items = items.filter((i) => i.type === "event" || i.status !== "done");
  if (overdue) items = items.filter((i) => isOpen(i) && isOverdueAt(i, now));
  if (done) items = items.filter((i) => isWork(i) && i.status === "done");
  if (cls) items = items.filter((i) => i.categoryId === cls.id);
  if (ref?.kind === "day") items = items.filter((i) => (i.type === "event" ? itemOccupiesDay(i, ref.day) : isDueOnDay(i, ref.day)));
  if (ref?.kind === "range") items = items.filter((i) => +new Date(i.at) >= +ref.start && +new Date(i.at) < +ref.end);
  // Without a day, a class's weekly meetings would be the whole semester.
  if (!ref && (kind === "class" || kind === "event") && purpose !== "done") return null;
  return items.sort(byAt);
}

const BULK_CAP: Record<string, number> = { "mark done": 20, "mark in progress": 20, reopen: 20, delete: 15, move: 15 };

function bulkResponse(env: Env, phrase: string, items: Item[], verb: string, action: (i: Item) => AssistantAction, detail?: (i: Item) => string): AssistantResponse | null {
  if (items.length > (BULK_CAP[verb] ?? 15)) return null;
  const what = expand(phrase).replace(/\b(?:all(?: of)?|everything|every|each|both|my|the)\b/g, " ").replace(/\s+/g, " ").trim() || "items";
  if (!items.length) {
    const phrase = /^(?:due|on|for|from|in)\b/.test(what) ? `anything ${what}` : `any ${what.replace(/\bas$/, "").trim()}`;
    return { text: `I don't see ${phrase} to ${verb}.` };
  }
  if (items.length === 1) {
    const one = items[0];
    const tail = detail ? ` ${detail(one)}` : "";
    return { text: `Just one: I'll ${verb === "mark done" ? `mark ${bold(one.title)} as done` : `${verb} ${bold(one.title)}${tail}`}. Confirm below.`, actions: [action(one)] };
  }
  const shown = items.slice(0, 6).map((i) => `${bold(i.title)}${detail ? ` (${detail(i)})` : ""}`);
  const more = items.length > 6 ? ` and ${items.length - 6} more` : "";
  const head = verb === "mark done" ? `I'll mark these ${items.length} as done` : `I'll ${verb} these ${items.length}`;
  return { text: `${head}: ${shown.join(", ")}${more}. Confirm each below.`, actions: items.map(action) };
}

/** "the essay and problem set 4" / "a, b and c" → each one, only if every part is unambiguous. */
function resolveSeveral(env: Env, phrase: string, scope: Scope): Item[] | null {
  if (!/,|\band\b|&/.test(phrase)) return null;
  const whole = resolveTarget(env, phrase, scope);
  if (whole.kind === "one") return null;
  const parts = phrase.split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const out: Item[] = [];
  for (const part of parts) {
    const t = resolveTarget(env, part, scope);
    if (t.kind !== "one") return null;
    if (!out.some((i) => i.id === t.item.id)) out.push(t.item);
  }
  return out.length >= 2 ? out : null;
}

function completeIntent(env: Env): Outcome {
  const { q, n } = env;
  // A question about finishing something is a lookup, not an order to finish it.
  if (/^(?:did|have|has|do|does|is|are|was|were|what|which|when|where|how|who|why|can|could|will)\b/.test(q)) return undefined;
  let m: RegExpExecArray | null;
  const reopen = /^(?:reopen|un-?complete|uncheck|undo|un-?finish|restore)\s+(.+)$/.exec(q) ?? /^(?:mark|set|put)\s+(.+?)\s+(?:as\s+|back\s+to\s+)?(?:not done|incomplete|not complete|unfinished|to ?do|todo|not finished|open)$/.exec(q);
  if (reopen) return setStatus(env, reopen[1], "todo");
  const doing = /^(?:start|begin|resume|work on|started|starting|i am (?:starting|working on|doing|beginning|on))\s+(.+)$/.exec(q) ?? /^(?:mark|set|put)\s+(.+?)\s+(?:as\s+|to\s+)?(?:in progress|doing|started|in-progress|underway|working on)$/.exec(q);
  if (doing) return setStatus(env, doing[1], "doing");
  if ((m = /^(?:mark|set|check off|tick off|cross off|complete)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished|off))?$/.exec(q))) {
    return setStatus(env, m[1].replace(/\s+(?:off|as|done)$/, ""), "done");
  }
  if ((m = /^(?:i(?: have|'ve)?\s+)?(?:just\s+)?(?:finished|completed|done|turned in|submitted|handed in|wrapped up|knocked out|did)\s+(?:with\s+)?(.+)$/.exec(q))) {
    return setStatus(env, m[1], "done");
  }
  if ((m = /^(?:done with|finished with)\s+(.+)$/.exec(q))) return setStatus(env, m[1], "done");
  if ((m = /^(.+?)\s+(?:is|are)\s+(?:all\s+)?(?:done|finished|complete|completed|submitted|turned in)$/.exec(q)) && !/^(?:what|which|how|when|who)\b/.test(q)) {
    return setStatus(env, m[1], "done");
  }
  void n;
  return undefined;
}

const MOVE_VERB = /^(move|reschedule|push|bump|shift|postpone|delay|put off|change)\s+(.+)$/;

const UNIT_MIN: Record<string, number> = { minute: 1, min: 1, hour: 60, hr: 60, day: 1440, week: 10080 };
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

function parseDelta(text: string): number | null {
  const m = /\b(?:by\s+)?(a|an|one|two|three|four|five|six|seven|couple(?: of)?|\d+)\s+(minute|min|hour|hr|day|week)s?\b(?:\s+(?:later|earlier|back|forward|ahead|out))?/.exec(text);
  if (!m) return null;
  const num = /^\d+$/.test(m[1]) ? +m[1] : WORD_NUM[m[1].replace(/ of$/, "")] ?? 1;
  return num * UNIT_MIN[m[2]];
}

function moveIntent(env: Env): Outcome {
  const { q, now } = env;
  const makeDue = /^make\s+(.+?)\s+due\s+(?:at|on|by)?\s*(.+)$/.exec(q);
  const verb = makeDue ? ["", "move", `${makeDue[1]} to ${makeDue[2]}`] : MOVE_VERB.exec(q);
  if (!verb) return undefined;
  const body = verb[2];

  type Attempt = { targetText: string; apply: (item: Item) => { at: Date } | null; detail: string };
  const attempts: Attempt[] = [];

  // "push X back a day", "delay X by 2 hours", "move X up an hour"
  const rel = /^(.+?)\s+(?:back|forward|out|up|ahead|earlier|later|by|another)?\s*((?:by\s+)?(?:a|an|one|two|three|four|five|six|seven|couple(?: of)?|\d+)\s+(?:minute|min|hour|hr|day|week)s?(?:\s+(?:later|earlier|back|forward|ahead|out))?)$/.exec(body);
  if (rel) {
    const minutes = parseDelta(rel[2]);
    if (minutes) {
      const earlier = /\b(?:earlier|up|ahead|forward)\b/.test(body.slice(rel[1].length)) && !/\b(?:later|back)\b/.test(body.slice(rel[1].length));
      const dir = verb[1] === "bump" || verb[1] === "push" || verb[1] === "postpone" || verb[1] === "delay" || verb[1] === "put off" ? (earlier ? -1 : 1) : earlier ? -1 : 1;
      attempts.push({
        targetText: rel[1],
        detail: "relative",
        apply: (item) => ({ at: addMinutes(new Date(item.at), dir * minutes) }),
      });
    }
  }

  // "move X to Friday", "reschedule X for 3pm tomorrow", "push X until monday"
  const seps = [...body.matchAll(/\s+(?:to|for|until|till|->|on|onto)\s+/g)];
  for (const sep of seps.reverse()) {
    const targetText = body.slice(0, sep.index);
    const whenText = body.slice((sep.index ?? 0) + sep[0].length);
    const w = expand(whenText);
    if (/^(?:the\s+)?(?:other|another|a different)\b/.test(w)) continue;
    const dayRef = findDayRef(w, now);
    const time = findTime(w);
    const nextWeek = /^(?:next week|a week from now|in a week)$/.test(w);
    const inDays = /^in\s+(a|an|one|two|three|\d+)\s+(day|week)s?$/.exec(w);
    if (!time && !nextWeek && !inDays && (!dayRef || dayRef.kind !== "day")) continue;
    attempts.push({
      targetText,
      detail: "absolute",
      apply: (item) => {
        const orig = new Date(item.at);
        if (nextWeek || inDays) {
          const n = nextWeek ? 7 : (/^\d+$/.test(inDays![1]) ? +inDays![1] : WORD_NUM[inDays![1]] ?? 1) * (inDays![2] === "week" ? 7 : 1);
          return { at: addDays(orig, n) };
        }
        const day = dayRef?.kind === "day" ? dayRef.day : startOfDay(orig);
        const t = time ? { h: time.h, m: time.m } : { h: orig.getHours(), m: orig.getMinutes() };
        return { at: atTime(day, t) };
      },
    });
  }

  const moveAction = (item: Item, to: Date): AssistantAction => {
    const from = new Date(item.at);
    const patch: Partial<Item> = { at: to.toISOString() };
    if (item.endAt) patch.endAt = new Date(+new Date(item.endAt) + (+to - +from)).toISOString();
    return update(item, `Move “${item.title}” to ${whenText(env, item, to)}`, patch);
  };
  const build = (attempt: Attempt): Build => (item, series) => {
    const result = attempt.apply(item);
    if (!result) return null;
    const from = new Date(item.at);
    const to = result.at;
    if (+to === +from) return { text: `${bold(item.title)} is already at that time — ${describeWhen(env, item)}.` };
    if (item.type !== "event" && item.status === "done") return null;
    const toText = whenText(env, item, to);
    const once = series > 1 ? " (just this one)" : "";
    const lead = item.type === "event" ? `Moving ${bold(item.title)}` : `Moving the ${bold(item.title)} deadline`;
    return { text: `${lead} from ${describeWhen(env, item)} to ${bold(toText)}${once}. Confirm below.`, actions: [moveAction(item, to)] };
  };

  for (const attempt of attempts) {
    const targetText = attempt.targetText
      .replace(/^(?:the\s+)?(?:due date|due time|deadline|start time|time|date|day)\s+(?:of|for|on)\s+/, "")
      .replace(/(?:'s|s')?\s+(?:due date|due time|deadline|start time|time|date)$/, "");
    if (isBulk(targetText)) {
      const items = selectBulk(env, targetText, "move");
      if (!items) return null;
      return bulkResponse(env, targetText, items, "move", (item) => moveAction(item, attempt.apply(item)!.at), (item) => `to ${whenText(env, item, attempt.apply(item)!.at)}`);
    }
    const several = resolveSeveral(env, targetText, "any");
    if (several) {
      if (several.length > 8) return null;
      const actions = several.map((item) => moveAction(item, attempt.apply(item)!.at));
      return { text: `I'll move ${joinNatural(several.map((i) => `${bold(i.title)} to ${whenText(env, i, attempt.apply(i)!.at)}`))}. Confirm below.`, actions };
    }
    const target = resolveTarget(env, targetText, "any");
    if (target.kind === "none") continue;
    if (target.kind === "many") return askWhich(env, target.items, build(attempt));
    return build(attempt)(target.item, target.series);
  }
  return undefined;
}

function whenText(env: Env, item: Item, to: Date): string {
  const eod = item.type !== "event" && to.getHours() === 23 && to.getMinutes() === 59;
  return `${dayName(to, env.now)}${item.allDay || eod ? "" : ` at ${fmtTime(to, env.ctx.clock24h)}`}`;
}

function deleteAction(item: Item): AssistantAction {
  return { kind: "delete", summary: `Delete “${item.title}”`, itemId: item.id, itemTitle: item.title };
}

function deleteIntent(env: Env): Outcome {
  const m = /^(?:delete|remove|cancel|trash|get rid of|drop|scrap|erase|clear)\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const phrase = m[1];
  if (/\b(?:whole|entire)\b/.test(phrase)) return null;
  if (/^(?:my |the )?(?:calendar|schedule|account|data|reminders?|history|chat|conversation)$/.test(phrase.trim())) return null;
  if (PRONOUN_ONLY.test(phrase.trim())) return null;
  if (isBulk(phrase)) {
    const items = selectBulk(env, phrase, "delete");
    if (!items) return null;
    return bulkResponse(env, phrase, items, "delete", deleteAction);
  }
  const several = resolveSeveral(env, phrase, "any");
  if (several) {
    if (several.length > 8) return null;
    return { text: `I'll delete ${joinNatural(several.map((i) => bold(i.title)))}. Confirm below.`, actions: several.map(deleteAction) };
  }
  const build: Build = (item, series) => {
    const once = series > 1 ? " — just this one, not the whole series" : "";
    return { text: `I'll delete ${bold(item.title)} (${describeWhen(env, item)})${once}. Confirm below.`, actions: [deleteAction(item)] };
  };
  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items, build);
  return build(target.item, target.series);
}

function renameIntent(env: Env): Outcome {
  const m = /^(?:rename|retitle|re-title)\s+(.+?)\s+(?:to|as)\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const original = /^(?:rename|retitle|re-title)\s+.+?\s+(?:to|as)\s+(.+)$/i.exec(env.n);
  const title = (original?.[1] ?? m[2]).trim().replace(/^["']|["']$/g, "");
  if (!title || title.length > 120) return null;
  const build: Build = (item) =>
    title === item.title
      ? { text: `${bold(title)} already has that name.` }
      : { text: `I'll rename ${bold(item.title)} to ${bold(title)}. Confirm below.`, actions: [update(item, `Rename to “${title}”`, { title })] };
  const target = resolveTarget(env, m[1], "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items, build);
  return build(target.item, target.series);
}

function reminderIntent(env: Env): Outcome {
  const m = /^(?:remind me (?:about|of)|add (?:a )?reminder (?:to|for|on)|set (?:a )?reminder (?:for|on|to)|add (?:a )?reminder)\s+(.+?)\s+((?:a|an|one|two|three|four|five|six|couple(?: of)?|\d+)\s+(?:minute|min|hour|hr|day|week)s?)\s+(?:before|early|ahead)$/.exec(env.q)
    ?? /^(?:remind me)\s+((?:a|an|one|two|three|four|five|six|couple(?: of)?|\d+)\s+(?:minute|min|hour|hr|day|week)s?)\s+before\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const swapped = /^remind me\s+(?:a|an|one|two|three|four|five|six|couple|\d+)\b/.test(env.q);
  const phrase = swapped ? m[2] : m[1];
  const minutes = parseDelta(swapped ? m[1] : m[2]);
  if (!minutes || minutes > 14 * 1440) return null;
  const label = formatOffsetLabel(minutes);
  const build: Build = (item) => {
    if (item.reminders?.some((r) => r.offsetMinutes === minutes && !r.place)) {
      return { text: `${bold(item.title)} already has a reminder ${label}.` };
    }
    const reminders = [...(item.reminders ?? []), { id: nanoid(), itemId: item.id, offsetMinutes: minutes, label }];
    return { text: `I'll add a reminder ${label} ${bold(item.title)}. Confirm below.`, actions: [update(item, `Remind ${label} “${item.title}”`, { reminders })] };
  };
  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items, build);
  return build(target.item, target.series);
}

/* ------------------------------------------------------------------ */
/* Field edits: class, location, notes                                 */
/* ------------------------------------------------------------------ */

function fieldEditIntent(env: Env): Outcome {
  const { q, n } = env;
  let m: RegExpExecArray | null;

  // "put the essay under econ", "move lab report to cs 101"
  if ((m = /^(?:put|move|file|assign|switch|change|set)\s+(.+?)\s+(?:under|in|into|to|as|for)\s+(?:the\s+|my\s+)?(.+?)(?:\s+class)?$/.exec(q))) {
    const cls = findClass(env, m[2]);
    const exact = cls && tokens(m[2].replace(/\bclass\b/, "")).every((t) => tokenMatches(t, categoryTokens(cls)));
    if (cls && exact && !findDayRef(m[2], env.now) && !findTime(m[2])) {
      const build: Build = (item) =>
        item.categoryId === cls.id
          ? { text: `${bold(item.title)} is already under ${bold(cls.name)}.` }
          : { text: `I'll move ${bold(item.title)} to ${bold(cls.name)}. Confirm below.`, actions: [update(item, `File “${item.title}” under ${cls.name}`, { categoryId: cls.id })] };
      const target = resolveTarget(env, m[1], "any");
      if (target.kind === "none") return null;
      if (target.kind === "many") return askWhich(env, target.items, build);
      return build(target.item, target.series);
    }
  }

  // "set the location of the dentist to Main St Dental", "change the lab's room to B204"
  const loc =
    /^(?:set|change|update|make)\s+(?:the\s+)?(?:location|place|room|venue|address)\s+(?:of|for)\s+(.+?)\s+to\s+(.+)$/i.exec(n) ??
    /^(?:set|change|update)\s+(.+?)(?:'s|’s)?\s+(?:location|room|place|venue|address)\s+to\s+(.+)$/i.exec(n);
  if (loc) {
    const location = loc[2].trim().replace(/^["']|["']$/g, "");
    if (!location || location.length > 120) return null;
    const build: Build = (item) => ({
      text: `I'll set the location of ${bold(item.title)} to ${bold(location)}. Confirm below.`,
      actions: [update(item, `Set location of “${item.title}” to ${location}`, { location })],
    });
    const target = resolveTarget(env, loc[1], "any");
    if (target.kind === "none") return null;
    if (target.kind === "many") return askWhich(env, target.items, build);
    return build(target.item, target.series);
  }

  // "add a note to the essay: use MLA", "note on lab report that it's in groups"
  const note = /^(?:add (?:a )?note|note|add notes?)\s+(?:to|on|for)\s+(.+?)\s*(?::|saying|that says|that)\s+(.+)$/i.exec(n);
  if (note) {
    const text = note[2].trim();
    if (!text || text.length > 500) return null;
    const build: Build = (item) => ({
      text: `I'll add that note to ${bold(item.title)}. Confirm below.`,
      actions: [update(item, `Add a note to “${item.title}”`, { description: item.description ? `${item.description}\n${text}` : text })],
    });
    const target = resolveTarget(env, note[1], "any");
    if (target.kind === "none") return null;
    if (target.kind === "many") return askWhich(env, target.items, build);
    return build(target.item, target.series);
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Planning work time                                                  */
/* ------------------------------------------------------------------ */

const PLAN_HEAD = /^(?:find|block(?: off| out)?|schedule|set aside|carve out|plan|reserve|save|make|give me|get me|book|put in|add)\s+(?:me\s+)?(?:some\s+)?/;
const PLAN_SPAN = /^((?:a|an|one|two|three|four|\d+(?:\.\d+)?|a couple(?: of)?|couple(?: of)?|half an?)\s+(?:hours?|hrs?|minutes?|mins?)|an? hour|time|study time|work time|(?:a )?(?:work|study|focus) (?:session|block|time)|a block|(?:a )?session)(?:\s+of\s+time)?\s*/;
const PLAN_PURPOSE = /^(?:(?:to|for)\s+)?(?:work(?:ing)? on|study(?:ing)? for|studying|study|do(?:ing)?|finish(?:ing)?|start(?:ing)?|prep(?:are|aring)?(?: for)?|review(?:ing)?(?: for)?|write|writing|focus(?:ing)? on|for)\s+/;

function spanMinutes(span: string): number {
  if (/^half an?/.test(span)) return 30;
  if (/couple/.test(span)) return 120;
  const m = /^(a|an|one|two|three|four|\d+(?:\.\d+)?)\s+(hours?|hrs?|minutes?|mins?)/.exec(span);
  if (!m) return 60;
  const n = /^\d/.test(m[1]) ? parseFloat(m[1]) : WORD_NUM[m[1]] ?? 1;
  return Math.round(/^h/.test(m[2]) ? n * 60 : n);
}

function busyBlocks(env: Env, day: Date) {
  return env.ctx.items
    .filter((i) => i.type === "event" && !i.allDay && itemOccupiesDay(i, day))
    .map((i) => ({ item: i, start: new Date(i.at), end: i.endAt ? new Date(i.endAt) : addMinutes(new Date(i.at), 60) }))
    .map((e) => ({ ...e, start: e.start < startOfDay(day) ? startOfDay(day) : e.start }))
    .sort((a, b) => +a.start - +b.start);
}

/** Open stretches on `day` between `fromH` and `toH`, never earlier than now. */
function freeGaps(env: Env, day: Date, fromH: number, toH: number): Array<[Date, Date]> {
  let start = atTime(day, { h: fromH, m: 0 });
  const end = atTime(day, { h: toH, m: 0 });
  // Leave a few minutes to get going: a block "starting now" is already late.
  if (+env.now + 10 * 60_000 > +start) start = new Date(Math.ceil((+env.now + 10 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  if (+start >= +end) return [];
  const gaps: Array<[Date, Date]> = [];
  let cursor = start;
  for (const e of busyBlocks(env, day)) {
    if (+e.end <= +cursor) continue;
    if (+e.start > +cursor) gaps.push([cursor, +e.start < +end ? e.start : end]);
    if (+e.end > +cursor) cursor = e.end;
    if (+cursor >= +end) break;
  }
  if (+cursor < +end) gaps.push([cursor, end]);
  return gaps.filter(([a, b]) => +b > +a);
}

function partOfDay(q: string): { from: number; to: number; label: string } | null {
  if (/\bmorning\b/.test(q)) return { from: 8, to: 12, label: "morning" };
  if (/\bafternoon\b/.test(q)) return { from: 12, to: 17, label: "afternoon" };
  if (/\b(?:evening|tonight|night)\b/.test(q)) return { from: 17, to: 22, label: "evening" };
  return null;
}

function plannerIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  let rest: string | null = null;
  let minutes = 60;
  const when = /^when (?:should|can|could) i (?:work on|study for|study|do|start|finish|get to)\s+(.+)$/.exec(q);
  if (when) rest = when[1];
  else {
    const head = PLAN_HEAD.exec(q);
    if (!head) return undefined;
    const afterHead = q.slice(head[0].length);
    const span = PLAN_SPAN.exec(afterHead);
    if (!span) return undefined;
    minutes = spanMinutes(span[1]);
    const afterSpan = afterHead.slice(span[0].length);
    // Day words may sit between the span and the purpose: "2 hours tomorrow for the essay".
    const lead = findDayRef(afterSpan, now);
    const trimmed = lead && afterSpan.indexOf(lead.text) === 0 ? afterSpan.slice(lead.text.length).trim() : afterSpan;
    const purpose = PLAN_PURPOSE.exec(trimmed);
    if (!purpose) return undefined;
    rest = `${trimmed.slice(purpose[0].length)}${lead && trimmed !== afterSpan ? ` ${lead.text}` : ""}`;
  }
  if (minutes < 15 || minutes > 6 * 60) return null;

  let phrase = rest;
  const part = partOfDay(phrase);
  const dayRef = findDayRef(phrase, now);
  if (dayRef) phrase = phrase.replace(dayRef.text, " ");
  const time = findTime(phrase);
  if (time) phrase = phrase.replace(time.text, " ");
  phrase = phrase.replace(/\b(?:in the |this |tomorrow )?(?:morning|afternoon|evening|tonight|night)\b/g, " ").replace(/\bbefore (?:it'?s|it is) due\b/g, " ").replace(/\s+/g, " ").trim();
  if (!phrase) return null;

  const asking = Boolean(when);
  const cls = findClass(env, phrase);
  if (cls && tokens(phrase.replace(/\b(?:class|course)\b/g, "")).every((t) => tokenMatches(t, categoryTokens(cls)))) {
    return planFor(env, { cls, minutes, dayRef, time, part, asking });
  }
  const build: Build = (item) => planFor(env, { item, minutes, dayRef, time, part, asking });
  let target = resolveTarget(env, phrase, "open-work");
  // "study for the midterm" — an exam on the calendar is a fine thing to plan toward.
  if (target.kind === "none") {
    const ev = resolveTarget(env, phrase, "any");
    if (ev.kind !== "none") target = ev.kind === "one" && ev.item.type !== "event" ? { kind: "none" } : ev;
  }
  if (target.kind === "many") return askWhich(env, target.items, build);
  if (target.kind === "one") return build(target.item, target.series);
  void ctx;
  return null;
}

function planFor(
  env: Env,
  o: { item?: Item; cls?: Category; minutes: number; dayRef: DayRef | null; time: TimeRef | null; part: { from: number; to: number; label: string } | null; asking?: boolean }
): AssistantResponse | null {
  const { now, ctx } = env;
  const due = o.item ? new Date(o.item.at) : null;
  const firstDay = o.dayRef?.kind === "day" ? o.dayRef.day : o.dayRef?.kind === "range" ? o.dayRef.start : startOfDay(now);
  const goalOpen = o.item && (o.item.type === "event" ? +due! > +now : isOpen(o.item));
  const lastDay = o.dayRef?.kind === "day" ? o.dayRef.day : o.dayRef?.kind === "range" ? addDays(o.dayRef.end, -1) : due && goalOpen && +due > +now ? startOfDay(due) : addDays(startOfDay(now), 6);
  const from = o.part?.from ?? WORK_START;
  const to = o.part?.to ?? WORK_END;
  const label = o.item ? o.item.title : `Study: ${o.cls!.name}`;

  let start: Date | null = null;
  let clash: Item | undefined;
  if (o.time) {
    start = atTime(firstDay, o.time);
    const end = addMinutes(start, o.minutes);
    clash = busyBlocks(env, firstDay).find((b) => +b.start < +end && +b.end > +start!)?.item;
  } else {
    for (let d = firstDay; +d <= +lastDay; d = addDays(d, 1)) {
      if (+d < +startOfDay(now)) continue;
      const gap = freeGaps(env, d, from, to).find(([a, b]) => +b - +a >= o.minutes * 60_000);
      if (gap) {
        start = gap[0];
        break;
      }
    }
  }
  const hours = o.minutes % 60 === 0 ? plural(o.minutes / 60, "hour") : o.minutes > 60 ? `${Math.floor(o.minutes / 60)}h ${o.minutes % 60}m` : `${o.minutes} minutes`;
  if (!start) {
    const span = o.dayRef ? o.dayRef.label : due ? "before it's due" : "this week";
    return { text: `I couldn't find a free ${hours.replace(/^1 hour$/, "hour")} ${o.part ? `in the ${o.part.label} ` : ""}${span} — your calendar's full${o.dayRef ? " then" : ""}. Want to try a shorter block, or a different day?` };
  }
  const isExam = o.item?.type === "event";
  if (due && +addMinutes(start, o.minutes) > +due && goalOpen) {
    return { text: `That would run past ${isExam ? "the start of " : "the deadline for "}${bold(o.item!.title)} (${describeWhen(env, o.item!)}). Pick an earlier time?` };
  }
  const end = addMinutes(start, o.minutes);
  const draft: Omit<Item, "id" | "createdAt"> = {
    type: "event",
    title: o.item ? `${isExam ? "Study for" : "Work on"}: ${o.item.title}` : `Study: ${o.cls!.name}`,
    categoryId: o.item?.categoryId ?? o.cls!.id,
    at: start.toISOString(),
    endAt: end.toISOString(),
    reminders: [],
    // Planned time points back at the work it serves; exams are events, so they don't.
    ...(o.item && !isExam ? { workFor: o.item.id } : {}),
    ...(o.item?.url ? { url: o.item.url } : {}),
  };
  const slot = `${dayName(start, now)}, ${fmtTime(start, ctx.clock24h)}–${fmtTime(end, ctx.clock24h)}`;
  const goal = bold(o.item ? o.item.title : o.cls!.name);
  const dueNote = o.item && goalOpen ? ` (${isExam ? "" : "due "}${describeWhen(env, o.item)})` : "";
  const clashNote = clash ? ` Heads up — that overlaps ${bold(clash.title)}.` : "";
  const keep = o.item && !isExam ? " Your deadline stays where it is." : "";
  const text = o.asking
    ? `Your next open ${hours.replace(/^1 hour$/, "hour")} is ${bold(slot)}. I can block it for ${goal}${dueNote}.${keep} Confirm below to add it.`
    : `I'll block ${bold(slot)} to ${isExam || !o.item ? "study for" : "work on"} ${goal}${dueNote}.${keep}${clashNote} Confirm below.`;
  return { text, actions: [{ kind: "create", summary: `Block ${slot} for “${label}”`, draft }] };
}

const ADD_VERB = /^(?:add|create|schedule|new|put|set up|book|block off|remind me to|remind me|make (?:a|an)|note that|i have|i've got|i have got|i got|i need to|i gotta|i have to|i must)\b/;
const HAS_TIME = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b|\bat\s+\d{1,2}\b|\ball[- ]day\b|\b(?:morning|afternoon|evening|tonight)\b/i;

const GLUE = new Set([
  "add", "create", "schedule", "book", "new", "put", "set", "up", "block", "off", "remind", "me", "to", "a", "an", "the",
  "at", "on", "in", "for", "by", "due", "event", "task", "assignment", "and", "this", "next", "of", "am", "pm",
  "tomorrow", "today", "tonight", "yesterday", "noon", "midnight", "morning", "afternoon", "evening", "all", "day",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "sun", "mon", "tue", "tues", "wed", "thu", "thurs", "fri", "sat",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december",
  "from", "until", "till", "through", "am", "pm", "hour", "hours", "minute", "minutes", "before", "after", "week", "weeks", "days",
  "with", "reminder", "reminders", "remind", "ping", "nudge", "early", "ahead", "couple", "few", "one", "two", "three",
  "every", "each", "weekly", "daily", "monthly", "weekday", "weekdays", "mondays", "tuesdays", "wednesdays", "thursdays",
  "fridays", "saturdays", "sundays", "starting", "semester", "end", "hr", "hrs", "min", "mins",
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/g, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !GLUE.has(w) && !/^\d+(?:st|nd|rd|th)?$/.test(w));
}

/**
 * The quick-add parser is generous about what it strips from a title. Local
 * adds are only trusted when nothing meaningful went missing ("lunch with sam"
 * must not become "Lunch sam"); otherwise the model writes the title.
 */
function titleIsFaithful(source: string, title: string, location: string | undefined, cat: Category | undefined): boolean {
  if (location && /^(?:noon|midnight|\d)/i.test(location.trim())) return false;
  const kept = new Set([...contentWords(title), ...contentWords(location ?? ""), ...contentWords(cat?.name ?? "")]);
  const wanted = contentWords(source);
  return wanted.every((w) => kept.has(w)) && [...contentWords(title)].every((w) => wanted.includes(w));
}

/** "olive garden" → "Olive Garden"; anything the user already cased, or "the library"-style common places, stays as typed. */
function placeName(location: string): string {
  if (/[A-Z]/.test(location) || /^(?:library|gym|office|home|school|work|campus|class|lab|dorm|park|store|cafe|coffee shop|dining hall|union|student center)$/i.test(location)) return location;
  return location.replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => (["of", "the", "and", "at", "on", "in"].includes(a + b) ? a + b : a.toUpperCase() + b));
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function repeatText(rule: RepeatRule): string {
  const until = rule.until ? ` until ${format(new Date(rule.until), "MMM d")}` : "";
  if (rule.freq === "daily") return `every day${until}`;
  if (rule.freq === "monthly") return `every month${until}`;
  const days = rule.byDay?.length ? rule.byDay.map((d) => DAY_NAMES[d]) : [];
  if (days.length === 5 && !rule.byDay!.includes(0) && !rule.byDay!.includes(6)) return `every weekday${until}`;
  return `${days.length ? `every ${joinNatural(days)}` : "every week"}${until}`;
}

function addIntent(env: Env): Outcome {
  const { n, q, ctx, now } = env;
  if (!ADD_VERB.test(q)) return undefined;
  if (/\?$/.test(env.raw) || /^i (?:have|got) (?:a )?(?:question|problem|issue|idea)/.test(q)) return null;
  if (n.length > 140 || /\n/.test(env.raw)) return null;
  // "remind me to…" and "I need to…" are things to do, not things that happen at a time.
  const isTask = /^(?:remind me|i need to|i gotta|i have to|i must|i(?:'ve| have) got to)\b/.test(q);
  const stripped = n.replace(/^(?:note that|remind me to|remind me|i(?:'ve| have) got to|i need to|i gotta|i have to|i must|i(?:'ve| have) got|i got|i have)\s+(?:an?\s+)?/i, "");
  const parsed = parseQuickAdd(stripped, ctx.categories);
  const reminderCount = parsed.reminders?.length ?? 0;
  // A reminder word the parser didn't turn into a reminder means it misread the sentence.
  const reminderWords = (stripped.match(/\b(?:remind(?:er|ers| me)?|ping me|nudge me)\b/gi) ?? []).length;
  if (reminderWords > reminderCount && !isTask) return null;
  if (reminderCount > 4) return null;
  // No date means the model should ask, not us guessing "today".
  if (!parsed.confidence.date) return null;
  const timed = HAS_TIME.test(stripped);
  if (parsed.type === "event" && !isTask && !parsed.allDay && !timed) return null;
  // "add a meeting at 3" — the parser treats the only noun as filler and leaves "Untitled".
  const bareNoun = /^untitled$/i.test(parsed.title) ? /\b(meeting|appointment|event|call|interview|session)\b/i.exec(stripped)?.[1] : undefined;
  if (bareNoun) parsed.title = bareNoun;
  const title = parsed.title.replace(/^(?:a|an|the)\s+/i, "").trim();
  if (!titleIsFaithful(stripped, parsed.title, parsed.location, ctx.categories.find((c) => c.id === parsed.categoryId))) return null;
  if (!title || title.length > 90 || title.split(/\s+/).length > 12) return null;
  if (!bareNoun && /^(?:a |the )?(?:reminder|event|task|assignment|meeting)$/i.test(title)) return null;

  const cat = ctx.categories.find((c) => c.id === parsed.categoryId);
  const reminders = parsed.reminders?.map((r) => ({ id: nanoid(), itemId: "", offsetMinutes: r.offsetMinutes, label: r.label }));
  const type = isTask && parsed.type === "event" ? "task" : parsed.type;
  const due = type !== "event" && !timed ? atTime(parsed.at, { h: 23, m: 59 }) : parsed.at;
  const draft: Omit<Item, "id" | "createdAt"> = {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    type,
    categoryId: parsed.categoryId ?? ctx.categories[0]?.id ?? "",
    at: due.toISOString(),
    ...(parsed.endAt ? { endAt: parsed.endAt.toISOString() } : {}),
    ...(parsed.allDay ? { allDay: true } : {}),
    ...(parsed.location ? { location: placeName(parsed.location) } : {}),
    ...(reminders?.length ? { reminders } : {}),
  };
  if (type !== "event") draft.status = "todo";
  const endOfDay = type !== "event" && !timed;
  const day = dayName(due, now);
  const relDay = /^(?:today|tomorrow|yesterday)$/.test(day);
  const whenText = parsed.allDay ? `${day} (all day)` : endOfDay ? day : `${day} at ${fmtTime(due, ctx.clock24h)}`;
  const spokenLocation = parsed.location && /[A-Z]/.test(placeName(parsed.location)) && placeName(parsed.location) !== parsed.location ? placeName(parsed.location) : parsed.location && new RegExp(`\\bthe ${parsed.location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(stripped) ? `the ${parsed.location}` : parsed.location;
  const extras = [
    spokenLocation ? `at ${spokenLocation}` : "",
    cat ? `under ${cat.name}` : "",
    parsed.reminderLabel ? `with a reminder ${parsed.reminderLabel}` : "",
  ].filter(Boolean);
  if (parsed.repeat) {
    draft.repeat = parsed.repeat;
    const rep = repeatText(parsed.repeat);
    const time = parsed.allDay ? "" : ` at ${fmtTime(due, ctx.clock24h)}`;
    const starting = relDay ? ` starting ${day}` : ` starting ${format(due, "MMM d")}`;
    extras.unshift(`${rep}${time}${starting}`);
    return {
      text: `I'll add ${bold(draft.title)}, ${bold(`${rep}${time}`)}${starting}${extras.length > 1 ? `, ${extras.slice(1).join(", ")}` : ""}. Confirm below.`,
      actions: [{ kind: "create", summary: `Add “${draft.title}” — ${rep}${time}`, draft }],
    };
  }
  if ((parsed.reminders?.length ?? 0) > 1) {
    extras.splice(extras.findIndex((e) => e.startsWith("with a reminder")), 1, `with reminders ${joinNatural(parsed.reminders!.map((r) => r.label))}`);
  }
  const lead =
    type === "event"
      ? `I'll add ${bold(draft.title)} ${relDay || parsed.allDay ? "" : "on "}${bold(whenText)}`
      : `I'll add ${bold(draft.title)}, due ${bold(whenText)}`;
  return {
    text: `${lead}${extras.length ? ` ${extras.join(", ")}` : ""}. Confirm below.`,
    actions: [{ kind: "create", summary: `Add “${draft.title}” — ${whenText}`, draft }],
  };
}

function pastedListIntent(env: Env): Outcome {
  if (!/\n/.test(env.raw) && env.raw.length < 60) return undefined;
  const multi = parseMultiAdd(env.raw, env.ctx.categories, env.now);
  if (multi.drafts.length < 2 || multi.skipped.length || multi.drafts.length > 25) return undefined;
  const drafts = [...multi.drafts].sort((a, b) => +a.at - +b.at);
  const fallbackCategoryId = env.ctx.categories[0]?.id;
  const describe = (d: (typeof drafts)[number]) =>
    `${format(d.at, "EEE, MMM d")}${d.allDay ? "" : ` at ${fmtTime(d.at, env.ctx.clock24h)}`}${d.location ? ` · ${d.location}` : ""}`;
  return {
    text: `I found ${drafts.length} items to add:\n${drafts.map((d) => `- **${d.title}** — ${describe(d)}`).join("\n")}\n\nConfirm below to add them.`,
    actions: drafts.map((d) => ({
      kind: "create" as const,
      summary: `Add “${d.title}” — ${describe(d)}`,
      draft: toNewItem(d, fallbackCategoryId),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Reading the calendar                                                */
/* ------------------------------------------------------------------ */

function isOpen(i: Item): boolean {
  return i.type !== "event" && i.status !== "done";
}
function isWork(i: Item): boolean {
  return i.type !== "event";
}
function byAt(a: Item, b: Item): number {
  return +new Date(a.at) - +new Date(b.at);
}

function inClass(env: Env, items: Item[], cls?: Category): Item[] {
  return cls ? items.filter((i) => i.categoryId === cls.id) : items;
}

function isClass(env: Env, i: Item): boolean {
  return isClassMeeting(i, categoryOf(env, i)?.name);
}

function className(env: Env, i: Item): string {
  return categoryOf(env, i)?.name ?? "";
}

function eventLine(env: Env, item: Item, day?: Date): string {
  const d = new Date(item.at);
  const cat = categoryOf(env, item);
  const title = isClass(env, item) && cat?.classTitle?.trim() ? cat.classTitle.trim() : item.title;
  let when: string;
  const startsToday = !day || isSameDay(d, day);
  if (item.allDay) when = "all day";
  else if (!startsToday) when = "continues";
  else {
    const end = item.endAt ? new Date(item.endAt) : null;
    when = end && isSameDay(end, d) && +end > +d ? `${fmtTime(d, env.ctx.clock24h)}–${fmtTime(end, env.ctx.clock24h)}` : fmtTime(d, env.ctx.clock24h);
  }
  return `${bold(title)} — ${when}${item.location ? ` · ${item.location}` : ""}`;
}

function dueLine(env: Env, item: Item, withDay = false): string {
  const d = new Date(item.at);
  const eod = d.getHours() === 23 && d.getMinutes() === 59;
  const cls = className(env, item);
  const when = withDay ? dayName(d, env.now) + (eod ? "" : ` at ${fmtTime(d, env.ctx.clock24h)}`) : eod || item.allDay ? "" : `at ${fmtTime(d, env.ctx.clock24h)}`;
  const state = item.status === "doing" ? " · in progress" : "";
  return `${bold(item.title)} — due${when ? ` ${when}` : ""}${cls ? ` · ${cls}` : ""}${state}`;
}

function bullets(lines: string[], max = 8): string {
  const shown = lines.slice(0, max).map((l) => `- ${l}`);
  if (lines.length > max) shown.push(`- …and ${lines.length - max} more`);
  return shown.join("\n");
}

type DayOpts = { only?: "events" | "work" | "classes"; evening?: boolean; cls?: Category; after?: Date; before?: Date };

function collectDay(env: Env, day: Date, opts: DayOpts) {
  const { now } = env;
  const isTodayDay = isSameDay(day, now);
  let events = env.ctx.items.filter((i) => i.type === "event" && itemOccupiesDay(i, day)).sort(byAt);
  let work = env.ctx.items.filter((i) => isWork(i) && isDueOnDay(i, day)).sort(byAt);
  events = inClass(env, events, opts.cls);
  work = inClass(env, work, opts.cls);
  if (opts.only === "classes") { events = events.filter((i) => isClass(env, i)); work = []; }
  if (opts.only === "events") work = [];
  if (opts.only === "work") events = [];
  if (opts.evening) events = events.filter((e) => e.allDay || new Date(e.at).getHours() >= 17 || (e.endAt && new Date(e.endAt).getHours() >= 18));
  if (opts.after) {
    events = events.filter((e) => !e.allDay && +new Date(e.at) >= +opts.after!);
    work = work.filter((w) => +new Date(w.at) >= +opts.after!);
  }
  if (opts.before) {
    events = events.filter((e) => !e.allDay && +new Date(e.at) < +opts.before!);
    work = work.filter((w) => +new Date(w.at) < +opts.before!);
  }
  const endedEvents = isTodayDay ? events.filter((e) => isEventEnded(e, now, day)) : [];
  const liveEvents = isTodayDay ? events.filter((e) => !isEventEnded(e, now, day)) : events;
  const doneWork = work.filter((w) => w.status === "done");
  const openWork = work.filter((w) => w.status !== "done");
  return { events: liveEvents, ended: endedEvents, openWork, doneWork, isToday: isTodayDay };
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function dayAnswer(env: Env, ref: Extract<DayRef, { kind: "day" }>, opts: DayOpts): AssistantResponse {
  const { now } = env;
  const day = ref.day;
  const { events, ended, openWork, doneWork, isToday } = collectDay(env, day, opts);
  const label = ref.label;
  const noun = opts.only === "classes" ? "class" : opts.only === "work" ? "thing due" : "thing";
  const past = day < startOfDay(now);
  const total = events.length + openWork.length;
  if (total === 0) {
    const bits: string[] = [];
    if (ended.length) bits.push(`${plural(ended.length, "earlier event")} already wrapped up`);
    if (doneWork.length) bits.push(`${plural(doneWork.length, "item")} already checked off`);
    const tail = bits.length ? ` (${bits.join(", ")})` : "";
    if (opts.only === "classes") return { text: past ? `You didn't have any classes ${label}.` : `You have no classes ${label}${tail}.` };
    if (opts.only === "work") return { text: `Nothing is due ${label}${tail}.` };
    if (past && doneWork.length) return { text: `Nothing was scheduled ${label}, but you finished ${joinNatural(doneWork.map((i) => bold(i.title)))}.` };
    return { text: past ? `Nothing was on your calendar ${label}.` : `Nothing on your calendar ${label}${tail} — it's clear.` };
  }
  const lines = [...events.map((e) => eventLine(env, e, day)), ...openWork.map((w) => dueLine(env, w))];
  const overdueNote =
    isToday && !opts.only && !opts.cls
      ? (() => {
          const od = env.ctx.items.filter((i) => isOpen(i) && !isDueOnDay(i, day) && isOverdueAt(i, now)).sort(byAt);
          if (!od.length) return "";
          if (od.length <= 2) return `\n\nStill overdue: ${joinNatural(od.map((i) => bold(i.title)))}.`;
          return `\n\nYou also have ${bold(`${od.length} overdue`)}.`;
        })()
      : "";
  const finishedNote =
    past && !opts.only
      ? (() => {
          const fin = env.ctx.items.filter((i) => isWork(i) && i.status === "done" && isSameDay(new Date(i.completedAt ?? i.at), day));
          return fin.length ? ` You also finished ${joinNatural(fin.map((i) => bold(i.title)))}.` : "";
        })()
      : "";
  const extra = ended.length ? ` ${plural(ended.length, "earlier event")} already finished.` : "";
  if (total <= 3) {
    const eventParts = events.map((e) => {
      const d = new Date(e.at);
      const cat = categoryOf(env, e);
      const title = isClass(env, e) && cat?.classTitle?.trim() ? cat.classTitle.trim() : e.title;
      return `${bold(title)} ${e.allDay ? "(all day)" : `at ${bold(fmtTime(d, env.ctx.clock24h))}`}${e.location ? ` in ${e.location}` : ""}`;
    });
    const workParts = openWork.map((w) => {
      const d = new Date(w.at);
      const eod = d.getHours() === 23 && d.getMinutes() === 59;
      return `${bold(w.title)} due${eod ? "" : ` at ${fmtTime(d, env.ctx.clock24h)}`}`;
    });
    const lead = past ? `${cap(label)} you had` : `${cap(label)} you have`;
    return { text: `${lead} ${joinNatural([...eventParts, ...workParts])}.${finishedNote}${extra}${overdueNote}` };
  }
  const counts = [events.length ? plural(events.length, "event") : "", openWork.length ? `${openWork.length} due` : ""].filter(Boolean).join(" and ");
  void noun;
  return { text: `${cap(label)} you have ${bold(counts)}:\n${bullets(lines, 10)}${finishedNote ? `\n\n${finishedNote.trim()}` : ""}${extra ? `\n\n${extra.trim()}` : ""}${overdueNote}` };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rangeAnswer(env: Env, ref: Extract<DayRef, { kind: "range" }>, opts: DayOpts): AssistantResponse {
  const { now } = env;
  const days: Date[] = [];
  const wholePast = +ref.end <= +startOfDay(now);
  for (let d = ref.start; d < ref.end && days.length < 31; d = addDays(d, 1)) if (d >= startOfDay(now) || wholePast) days.push(d);
  const rows: { day: Date; lines: string[]; events: number; due: number }[] = [];
  let events = 0;
  let due = 0;
  for (const day of days) {
    const c = collectDay(env, day, opts);
    const evs = c.events;
    const lines = [
      ...evs.map((e) => {
        const cat = categoryOf(env, e);
        const title = isClass(env, e) && cat?.classTitle?.trim() ? cat.classTitle.trim() : e.title;
        return e.allDay ? `${bold(title)} (all day)` : `${bold(title)} ${fmtTime(e.at, env.ctx.clock24h)}`;
      }),
      ...c.openWork.map((w) => `${bold(w.title)} due${new Date(w.at).getHours() === 23 && new Date(w.at).getMinutes() === 59 ? "" : ` ${fmtTime(w.at, env.ctx.clock24h)}`}`),
    ];
    if (lines.length) rows.push({ day, lines, events: evs.length, due: c.openWork.length });
    events += evs.length;
    due += c.openWork.length;
  }
  const noun = opts.only === "work" ? "due" : opts.only === "classes" ? "class" : "";
  if (!rows.length) {
    return { text: opts.only === "work" ? `Nothing is due ${ref.label}.` : opts.only === "classes" ? `No classes ${ref.label}.` : `Nothing on your calendar ${ref.label}.` };
  }
  const summary = joinNatural([events ? plural(events, opts.only === "classes" ? "class" : "event", opts.only === "classes" ? "classes" : "events") : "", due ? `${due} due` : ""].filter(Boolean));
  void noun;
  const hiddenDays = rows.length > 8 ? rows.length - 8 : 0;
  const body = rows
    .slice(0, 8)
    .map((r) => {
      const shown = r.lines.slice(0, 4);
      const more = r.lines.length - shown.length;
      return `- **${dayName(r.day, now) === "today" || dayName(r.day, now) === "tomorrow" ? cap(dayName(r.day, now)) : format(r.day, "EEE, MMM d")}** — ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
    })
    .join("\n");
  const past = +ref.end <= +startOfDay(now);
  return { text: `${cap(ref.label)} you ${past ? "had" : "have"} ${bold(summary)}:\n${body}${hiddenDays ? `\n- …and ${plural(hiddenDays, "more day")}` : ""}` };
}

/** Everything open, soonest first — the "what's due" family with no day named. */
function upcomingWork(env: Env, cls: Category | undefined, extra: (i: Item) => boolean = () => true, noun = "item"): AssistantResponse {
  const { now } = env;
  const open = inClass(env, env.ctx.items.filter(isOpen).filter(extra), cls).sort(byAt);
  const label = cls ? ` for ${cls.name}` : "";
  if (!open.length) return { text: `Nothing outstanding${label} — you're all caught up.` };
  const overdue = open.filter((i) => isOverdueAt(i, now));
  const ahead = open.filter((i) => !isOverdueAt(i, now));
  const head = `You have ${bold(`${open.length} open ${open.length === 1 ? noun : `${noun}s`}`)}${label}${overdue.length ? `, ${overdue.length} overdue` : ""}.`;
  const lines = [...overdue, ...ahead].slice(0, 8).map((i) => dueLine(env, i, true));
  return { text: `${head}\n${bullets(lines, 8)}${open.length > 8 ? "" : ""}` };
}

function dueBetween(env: Env, start: Date, end: Date, label: string, cls?: Category, opts: { includeOverdue?: boolean } = {}): AssistantResponse {
  const { now } = env;
  const open = inClass(env, env.ctx.items.filter(isOpen), cls).sort(byAt);
  const inRange = open.filter((i) => +new Date(i.at) >= +start && +new Date(i.at) < +end);
  const overdue = opts.includeOverdue ? open.filter((i) => isOverdueAt(i, now) && +new Date(i.at) < +start) : [];
  const all = [...overdue, ...inRange];
  const suffix = cls ? ` for ${cls.name}` : "";
  if (!all.length) return { text: `Nothing due ${label}${suffix}.` };
  if (all.length <= 3) {
    const parts = all.map((i) => `${bold(i.title)} (${dayName(new Date(i.at), now)}${new Date(i.at).getHours() === 23 && new Date(i.at).getMinutes() === 59 ? "" : ` at ${fmtTime(i.at, env.ctx.clock24h)}`})`);
    return { text: `${cap(label)}${suffix} you have ${joinNatural(parts)} due.${overdue.length ? ` ${overdue.length === 1 ? "That first one is" : "The overdue ones are"} already past due.` : ""}`.replace("You have", "you have") };
  }
  return { text: `You have ${bold(`${all.length} due`)} ${label}${suffix}:\n${bullets(all.map((i) => dueLine(env, i, true)), 8)}` };
}

function refineOpts(q: string, cls: Category | undefined): DayOpts {
  const only = /\b(?:class(?:es)?|lectures?|labs?|sections?)\b/.test(q)
    ? "classes"
    : /\b(?:due|deadlines?|assignments?|homework|hw|tasks?|to-?dos?|turn in|hand in|submit|projects?|papers?|essays?)\b/.test(q)
      ? "work"
      : /\b(?:events?|meetings?|appointments?)\b/.test(q)
        ? "events"
        : undefined;
  return { only, cls };
}

const AGENDA_VOCAB = new Set([
  "what", "anything", "something", "show", "list", "agenda", "schedule", "plan", "going", "happening", "got", "calendar",
  "due", "busy", "need", "plate", "looking", "look", "like", "class", "classe", "lecture", "lab", "section", "event",
  "meeting", "appointment", "assignment", "homework", "hw", "task", "todo", "deadline", "left", "else", "still",
  "remaining", "open", "upcoming", "coming", "doing", "get", "gotta", "work", "turn", "submit", "hand", "project",
  "paper", "essay", "exam", "quiz", "test", "week", "weekend", "month", "rest", "day", "happen", "tonight", "morning",
  "afternoon", "evening", "else", "stuff", "thing", "much", "many", "how", "ahead", "whole", "entire", "full",
  "s", "nothing", "there", "any", "anything", "everything", "sure", "again", "exactly", "overview", "rundown", "summary",
  "left", "yet", "done", "after", "before", "until", "today", "tomorrow", "next", "this", "last", "should", "wa",
]);

function agendaIntent(env: Env): Outcome {
  const { q, now } = env;
  const ref = findDayRef(q, now);
  const cls = findClass(env, q);
  const agendaWords =
    /\b(?:what|anything|something|show|list|agenda|schedule|plans?|going on|happening|have|got|calendar|due|up|busy|need|do i|on|plate|looking)\b/.test(q);
  const leftover = ref ? q.replace(ref.text, "").replace(/\b(?:on|for|this|next)\b/g, "").replace(/\s+/g, " ").trim() : "";
  const bareDay = Boolean(ref) && /^(?:(?:the )?(?:schedule|agenda|plans|calendar)|'s (?:schedule|agenda|plans)|)$/.test(leftover);
  if (!agendaWords && !bareDay) return undefined;
  if (/\b(?:add|create|move|delete|remove|cancel|rename|reschedule|push|mark)\b/.test(q)) return undefined;
  const opts = refineOpts(q, cls);
  const bareClassName = cls && !ref;
  // "what's the weather tomorrow" has a day in it but isn't about the calendar.
  const rest = tokens((ref ? q.replace(ref.text, " ") : q).replace(/\b(?:after|before|until) (?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|lunch)\b/g, " "))
    .filter((t) => !AGENDA_VOCAB.has(t) && !categoryTokens(cls).includes(t));
  if (rest.length && !rest.every((t) => env.ctx.items.some((i) => tokenMatches(t, tokens(i.title))))) return undefined;
  const clock = /\b(after|before|until)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon)\b/.exec(q);
  if (clock && ref?.kind !== "range") {
    const t = findTime(`at ${clock[2]}`);
    const day = ref?.kind === "day" ? ref : { kind: "day" as const, day: startOfDay(now), label: "today", text: "" };
    if (t) {
      const cut = atTime(day.day, t);
      if (clock[1] === "after") opts.after = cut;
      else opts.before = cut;
      return dayAnswer(env, { ...day, label: `${clock[1] === "after" ? "after" : "before"} ${fmtTime(cut, env.ctx.clock24h)} ${day.label}` }, opts);
    }
  }

  if (ref && !bareClassName) {
    const by = /\b(by|before|until|till|through|thru)\b/.test(q.replace(ref.text, "_")) && (opts.only === "work" || /\bdue\b/.test(q));
    if (by && ref.kind === "day") {
      const inclusive = !/\bbefore\b/.test(q);
      const end = inclusive ? addDays(ref.day, 1) : ref.day;
      return dueBetween(env, startOfDay(now), end, `by ${ref.label}`, cls, { includeOverdue: true });
    }
    if (ref.kind === "day") {
      if (ref.evening) opts.evening = true;
      return dayAnswer(env, ref, opts);
    }
    if (opts.only === "work") return dueBetween(env, ref.start < startOfDay(now) ? startOfDay(now) : ref.start, ref.end, ref.label, cls, { includeOverdue: false });
    return rangeAnswer(env, ref, opts);
  }

  if (/^(?:what is )?(?:on )?my plate$/.test(q.replace(/^what is on/, "what is on"))) return upcomingWork(env, cls);
  if (/^(?:list|show)(?: me)?(?: my| all my)?(?: upcoming)? (?:events|calendar)$/.test(q)) {
    return rangeAnswer(env, { kind: "range", start: startOfDay(now), end: addDays(startOfDay(now), 7), label: "over the next 7 days", text: "" }, { only: "events" });
  }
  if (/\b(?:due|deadlines?|assignments?|homework|hw|to-?dos?|tasks?)\b/.test(q) && /\b(?:what|which|any|do i|have i|show|list|upcoming|coming|left|outstanding|remaining|open|need)\b/.test(q)) {
    if (/\b(?:overdue|late|behind|past due|missed|missing)\b/.test(q)) return undefined;
    const kind = /\bassignments?\b|\bhomework\b|\bhw\b/.test(q) ? "assignment" : /\btasks?\b|\bto-?dos?\b/.test(q) ? "task" : undefined;
    return upcomingWork(env, cls, (i) => !kind || i.type === kind, kind ?? "item");
  }
  return undefined;
}

function overdueIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/\b(?:overdue|past due|late|behind|missed|forgot(?:ten)?|slipped|fallen behind)\b/.test(q)) return undefined;
  if (!/\b(?:what|which|any|anything|am i|do i|have i|how many|show|list|is there|are there|things)\b/.test(q)) return undefined;
  if (/\b(?:add|create|move|mark|delete|remind)\b/.test(q)) return undefined;
  const cls = findClass(env, q);
  const od = inClass(env, env.ctx.items.filter((i) => isOpen(i) && isOverdueAt(i, now)), cls).sort(byAt);
  const label = cls ? ` for ${cls.name}` : "";
  if (/\bhow many\b/.test(q)) return { text: od.length ? `You have ${bold(plural(od.length, "overdue item"))}${label}.` : `Nothing overdue${label}.` };
  if (!od.length) return { text: /\bam i (?:behind|late)\b/.test(q) ? `Not at all — nothing is overdue${label}.` : `Nothing overdue${label} — you're on top of it.` };
  const lines = od.map((i) => `${bold(i.title)} — was due ${dayName(new Date(i.at), now)} (${relative(new Date(i.at), now)})${!label && className(env, i) ? ` · ${className(env, i)}` : ""}`);
  if (od.length <= 3) return { text: `You have ${bold(`${od.length} overdue`)}${label}: ${joinNatural(od.map((i) => `${bold(i.title)} (${dayName(new Date(i.at), now)})`))}.` };
  return { text: `You have ${bold(`${od.length} overdue`)}${label}:\n${bullets(lines, 8)}` };
}

function didIFinishIntent(env: Env): Outcome {
  const m = /^(?:did|have) i (?:already )?(?:finish|finished|complete|completed|do|done|turn in|submit|submitted|hand in)\s+(?:with\s+)?(.+)$/.exec(env.q);
  if (!m || /\b(?:today|yesterday|this week|last week|anything|everything|all|last night)\b/.test(m[1])) return undefined;
  const target = resolveTarget(env, m[1], "any");
  if (target.kind !== "one" || target.item.type === "event") return null;
  const { item } = target;
  if (item.status === "done") {
    return { text: `Yes — ${bold(item.title)} is marked done${item.completedAt ? ` (${dayName(new Date(item.completedAt), env.now)})` : ""}.` };
  }
  const d = new Date(item.at);
  return { text: `Not yet — ${bold(item.title)} is still ${item.status === "doing" ? "in progress" : "open"}, due ${bold(dayName(d, env.now))}.` };
}

function progressIntent(env: Env): Outcome {
  const { q } = env;
  if (!/\b(?:in progress|working on|started|doing|underway|in-progress)\b/.test(q)) return undefined;
  if (!/^(?:what|which|any|am i|do i|show|list|is there)/.test(q) || /\b(?:mark|set|start|move)\b/.test(q)) return undefined;
  if (/\bnow\b/.test(q) && /\bclass\b/.test(q)) return undefined;
  const doing = env.ctx.items.filter((i) => isOpen(i) && i.status === "doing").sort(byAt);
  if (!doing.length) return { text: "Nothing is marked in progress right now." };
  if (doing.length <= 3) return { text: `You're working on ${joinNatural(doing.map((i) => `${bold(i.title)} (due ${dayName(new Date(i.at), env.now)})`))}.` };
  return { text: `You have ${bold(`${doing.length} items in progress`)}:\n${bullets(doing.map((i) => dueLine(env, i, true)), 8)}` };
}

function completedIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/\b(?:finish(?:ed)?|completed?|done|checked off|turned in|submitted|knocked out|accomplished)\b/.test(q)) return undefined;
  if (!/^(?:what|which|how many|did i|have i|show|list|anything|any)/.test(q)) return undefined;
  if (/\b(?:mark|set|add|move|delete)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  let start = addDays(startOfDay(now), -6);
  let end = addDays(startOfDay(now), 1);
  let label = "in the last 7 days";
  if (ref?.kind === "day") { start = ref.day; end = addDays(ref.day, 1); label = ref.label === "today" || ref.label === "yesterday" ? ref.label : `on ${ref.label}`; }
  if (ref?.kind === "range") { start = ref.label === "this week" ? addDays(startOfDay(now), -((now.getDay() - (env.ctx.weekStartsOn ?? 0) + 7) % 7)) : ref.start; end = ref.end > addDays(startOfDay(now), 1) ? addDays(startOfDay(now), 1) : ref.end; label = ref.label; }
  const cls = findClass(env, q);
  const done = inClass(env, env.ctx.items.filter((i) => isWork(i) && i.status === "done"), cls)
    .filter((i) => { const t = new Date(i.completedAt ?? i.at); return t >= start && t < end; })
    .sort((a, b) => +new Date(b.completedAt ?? b.at) - +new Date(a.completedAt ?? a.at));
  if (/\bhow many\b/.test(q)) return { text: done.length ? `You finished ${bold(plural(done.length, "item"))} ${label}.` : `Nothing finished ${label} yet.` };
  if (!done.length) return { text: +end <= +startOfDay(now) ? `You didn't check anything off ${label}.` : `You haven't finished anything ${label} yet.` };
  if (done.length <= 3) return { text: `You finished ${bold(plural(done.length, "item"))} ${label}: ${joinNatural(done.map((i) => bold(i.title)))}.` };
  return { text: `You finished ${bold(plural(done.length, "item"))} ${label}:\n${bullets(done.map((i) => bold(i.title)), 8)}` };
}

function nextIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m =
    /^(?:what|which)\s+(?:is\s+)?(?:my\s+|the\s+)?next\s*(class|lecture|event|meeting|appointment|assignment|task|exam|quiz|test|midterm|final|deadline|due date|due|thing)?(?:\s+due)?$/.exec(q) ??
    /^(?:when|what time)\s+is\s+(?:my\s+|the\s+)?next\s+(class|lecture|event|meeting|appointment|assignment|task|exam|quiz|test|midterm|final|deadline)$/.exec(q) ??
    /^(?:what is )?(?:up next|next up|coming up|what is coming up|whats next|what is next|what do i have (?:next|coming up)|what have i got (?:next|coming up)|what is on next)$/.exec(q) ??
    /^(?:my )?next\s+(class|lecture|event|meeting|appointment|assignment|task|exam|quiz|test|midterm|final|deadline)$/.exec(q) ??
    /^when (?:do i|does my|is my) (?:have )?(?:my )?next\s*(class|lecture|meeting|event)?(?: start| begin)?$/.exec(q);
  if (!m) return undefined;
  const kind = (m[1] ?? "").toLowerCase();
  const cls = findClass(env, q);
  const upcomingEvent = (pred: (i: Item) => boolean) =>
    inClass(env, ctx.items.filter((i) => i.type === "event" && pred(i)), cls)
      .filter((i) => !isEventEnded(i, now, new Date(i.at)) && +new Date(i.endAt && !i.allDay ? i.endAt : i.at) >= +now || (i.allDay && +startOfDay(new Date(i.at)) >= +startOfDay(now)))
      .filter((i) => !i.allDay || +startOfDay(new Date(i.at)) >= +startOfDay(now))
      .sort(byAt)[0];
  const upcomingWorkItem = (pred: (i: Item) => boolean) =>
    inClass(env, ctx.items.filter((i) => isOpen(i) && pred(i)), cls).filter((i) => +new Date(i.at) >= +now || !isOverdueAt(i, now)).sort(byAt)[0];

  const describeEvent = (e: Item, lead: string) => {
    const d = new Date(e.at);
    const running = +d <= +now;
    const until = running ? null : untilPhrase(d, now);
    const cat = categoryOf(env, e);
    const title = isClass(env, e) && cat?.classTitle?.trim() ? cat.classTitle.trim() : e.title;
    const where = e.location ? ` in ${e.location}` : "";
    if (running) return `${lead} ${bold(title)} is happening now${e.endAt ? ` until ${fmtTime(e.endAt, ctx.clock24h)}` : ""}${where}.`;
    return `${lead} ${bold(title)} ${e.allDay ? `${dayName(d, now)} (all day)` : `${dayName(d, now)} at ${bold(fmtTime(d, ctx.clock24h))}`}${until ? ` — ${until}` : ""}${where}.`;
  };
  const describeWorkShort = (w: Item) => {
    const d = new Date(w.at);
    const eod = d.getHours() === 23 && d.getMinutes() === 59;
    return `${bold(w.title)}, due ${bold(dayName(d, now))}${eod ? "" : ` at ${fmtTime(d, ctx.clock24h)}`}${className(env, w) ? ` (${className(env, w)})` : ""}`;
  };

  if (/^(?:class|lecture)$/.test(kind)) {
    const e = upcomingEvent((i) => isClass(env, i));
    return { text: e ? describeEvent(e, "Your next class is") : "I don't see any upcoming classes on your calendar." };
  }
  if (/^(?:event|meeting|appointment)$/.test(kind)) {
    const e = upcomingEvent((i) => !isClass(env, i) || kind === "event");
    return { text: e ? describeEvent(e, "Your next event is") : "You don't have any upcoming events." };
  }
  if (/^(?:assignment|task|deadline|due date|due)$/.test(kind)) {
    const w = upcomingWorkItem((i) => (kind === "assignment" ? i.type === "assignment" : kind === "task" ? i.type === "task" : true));
    if (!w) return { text: "Nothing is outstanding — you're all caught up." };
    const noun = kind === "task" ? "task" : kind === "assignment" ? "assignment" : "deadline";
    return { text: `Your next ${noun} is ${describeWorkShort(w)}.` };
  }
  if (/^(?:exam|quiz|test|midterm|final)$/.test(kind)) {
    const re = new RegExp(`\\b${kind === "test" ? "test" : kind}s?\\b`, "i");
    const cand = ctx.items.filter((i) => re.test(i.title) && (i.type === "event" ? +new Date(i.endAt ?? i.at) >= +now : i.status !== "done" && +new Date(i.at) >= +startOfDay(now))).sort(byAt)[0];
    if (!cand) return null;
    const d = new Date(cand.at);
    return { text: `Your next ${kind} is ${bold(cand.title)} — ${bold(dayName(d, now))}${cand.allDay || (cand.type !== "event" && d.getHours() === 23) ? "" : ` at ${fmtTime(d, ctx.clock24h)}`} (${relative(d, now)}).` };
  }
  // "What's next?" — the soonest thing of any kind, plus the soonest of the other kind.
  const e = upcomingEvent(() => true);
  const w = upcomingWorkItem(() => true);
  if (!e && !w) return { text: "Nothing coming up — your calendar is clear." };
  if (e && (!w || +new Date(e.at) <= +new Date(w.at))) {
    return { text: `${describeEvent(e, "Up next:")}${w ? ` After that: ${describeWorkShort(w)}.` : ""}` };
  }
  return { text: `Up next: ${describeWorkShort(w!)}.${e ? ` ${describeEvent(e, "Your next event is")}` : ""}` };
}

function classesIntent(env: Env): Outcome {
  const { q, ctx } = env;
  if (!/^(?:what|which) (?:are )?(?:my )?(?:classes|courses)(?: am i (?:taking|in|enrolled in))?(?: this (?:semester|term))?$|^(?:list|show)(?: me)? (?:all )?my (?:classes|courses)$|^what (?:classes|courses) (?:am i|do i) (?:taking|take|have|in)(?: this (?:semester|term))?$|^how many (?:classes|courses) (?:am i taking|do i have|do i take)(?: this (?:semester|term))?$/.test(q)) return undefined;
  const classes = ctx.categories.filter((c) => !c.archived && !/^(?:personal|work|home|family|life|imported|uncategorized|general|misc|miscellaneous|other)$/i.test(c.name.trim()));
  if (!classes.length) return { text: "You haven't added any classes yet. Add them under **Settings → Classes**, or import a syllabus and I'll set one up." };
  if (/^how many/.test(q)) return { text: `You're taking ${bold(plural(classes.length, "class", "classes"))}: ${joinNatural(classes.map((c) => bold(c.name)))}.` };
  const lines = classes.map((c) => {
    const meets = savedClassMeetings(ctx.items, c.id);
    const summary = meets.length ? meets.map((m) => formatMeetingSummary(m, ctx.clock24h)).join(", ") : c.syllabus?.meetings;
    const prof = c.syllabus?.people.find((p) => p.role === "instructor");
    return `- ${bold(c.name)}${summary ? ` — ${summary}` : ""}${prof ? ` · ${prof.name}` : ""}`;
  });
  return { text: `You're taking ${plural(classes.length, "class", "classes")}:\n${lines.join("\n")}` };
}

function whereNextIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/^where (?:is|do i have) (?:my |the )?next (?:class|lecture|event|meeting)$|^where (?:do i|should i) (?:go|be) next$/.test(q)) return undefined;
  const classOnly = /\b(?:class|lecture)\b/.test(q);
  const next = ctx.items
    .filter((i) => i.type === "event" && !i.allDay && (!classOnly || isClass(env, i)) && +new Date(i.endAt ?? i.at) >= +now)
    .sort(byAt)[0];
  if (!next) return { text: classOnly ? "I don't see any upcoming classes." : "Nothing coming up on your calendar." };
  const d = new Date(next.at);
  const where = next.location ?? (categoryOf(env, next)?.syllabus?.location);
  return {
    text: where
      ? `Your next ${classOnly ? "class" : "stop"}, ${bold(next.title)}, is in ${bold(where)} — ${dayName(d, now)} at ${fmtTime(d, ctx.clock24h)}.`
      : `Your next ${classOnly ? "class" : "thing"} is ${bold(next.title)} ${dayName(d, now)} at ${fmtTime(d, ctx.clock24h)}, but it doesn't have a location saved.`,
  };
}

/* ------------------------------------------------------------------ */
/* Dates, countdowns, progress                                         */
/* ------------------------------------------------------------------ */

function dateMathIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  let m: RegExpExecArray | null;

  // "what day is oct 12", "what's the date next friday"
  if ((m = /^(?:what|which) (?:day(?: of the week)?|date) (?:is|was|will be|falls on|lands on)\s+(.+)$/.exec(q) ?? /^what is the date (?:on |of )?(.+)$/.exec(q))) {
    const ref = findDayRef(m[1], now);
    if (!ref || ref.kind !== "day" || m[1].replace(ref.text, "").replace(/\b(?:it|going to be)\b/g, "").trim()) return undefined;
    const asksWeekday = /\bday\b/.test(q.slice(0, 20)) && /\d/.test(ref.text);
    return { text: asksWeekday ? `${format(ref.day, "MMMM d")} is a ${bold(format(ref.day, "EEEE"))}.` : `${cap(ref.label)} is ${bold(format(ref.day, "EEEE, MMMM d"))}.` };
  }

  // "how many days until spring break", "how long until my next class", "days till the essay is due"
  if ((m = /^(?:how (?:many|much) (?:days|weeks|time|hours)|how long|days|weeks) (?:until|till|til|before|left (?:until|till|before))\s+(.+?)(?:\s+(?:is due|is|starts|begins|happens))?$/.exec(q))) {
    const subject = m[1].replace(/^(?:my|the)\s+/, "").trim();
    const unitWeeks = /^(?:how many weeks|weeks)/.test(q);
    const say = (label: string, target: Date, exactTime: boolean) => {
      const days = differenceInCalendarDays(startOfDay(target), startOfDay(now));
      if (days < 0) return { text: `${label} already passed — it was ${relative(target, now)}.` };
      if (days === 0) {
        const until = exactTime ? untilPhrase(target, now) : null;
        return { text: `${label} is ${bold("today")}${until ? ` — ${until}` : ""}.` };
      }
      if (unitWeeks) {
        const w = Math.round((days / 7) * 10) / 10;
        return { text: `${label} is ${bold(`${w} week${w === 1 ? "" : "s"}`)} away (${format(target, "EEE, MMM d")}).` };
      }
      const hours = exactTime ? untilPhrase(target, now) : null;
      return { text: `${label} is ${bold(days === 1 ? "tomorrow" : `${days} days`)} away${days === 1 && hours ? ` — ${hours}` : ` (${format(target, "EEE, MMM d")})`}.` };
    };
    if (/^next (?:class|lecture)$/.test(subject)) {
      const next = ctx.items.filter((i) => i.type === "event" && !i.allDay && isClass(env, i) && +new Date(i.at) > +now).sort(byAt)[0];
      if (!next) return { text: "I don't see any upcoming classes." };
      const until = untilPhrase(new Date(next.at), now);
      return until ? { text: `Your next class, ${bold(next.title)}, starts ${bold(until)}.` } : say(`Your next class, ${bold(next.title)},`, new Date(next.at), true);
    }
    const ref = findDayRef(subject, now);
    if (ref && !subject.replace(ref.text, "").trim()) return say(cap(ref.label), ref.kind === "day" ? ref.day : ref.start, false);
    const target = resolveTarget(env, subject, "any");
    if (target.kind === "one") return say(bold(target.item.title), new Date(target.item.at), !target.item.allDay);
    // Syllabus dates — "spring break", "the drop deadline".
    const want = tokens(subject);
    for (const c of ctx.categories) {
      const hit = c.syllabus?.keyDates.find((k) => want.length && want.every((w) => tokenMatches(w, tokens(k.label))));
      if (hit) {
        const [y, mo, d] = hit.date.split("-").map(Number);
        return say(bold(hit.label), new Date(y, mo - 1, d), false);
      }
    }
    return target.kind === "many" ? askWhich(env, target.items, (item) => say(bold(item.title), new Date(item.at), !item.allDay)) : null;
  }

  // "how long is the midterm", "how long does lecture last"
  if ((m = /^how long (?:is|does|will) (?:my |the )?(.+?)(?:\s+(?:last|take|run|go))?$/.exec(q))) {
    const target = resolveTarget(env, m[1], "any");
    if (target.kind !== "one" || target.item.type !== "event") return target.kind === "none" ? undefined : null;
    const e = target.item;
    if (!e.endAt || e.allDay) return { text: `${bold(e.title)} doesn't have an end time saved${e.allDay ? " — it's an all-day event" : ""}.` };
    const mins = Math.round((+new Date(e.endAt) - +new Date(e.at)) / 60_000);
    const dur = mins % 60 === 0 ? plural(mins / 60, "hour") : mins > 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} minutes`;
    return { text: `${bold(e.title)} runs ${bold(dur)}, ${fmtTime(e.at, ctx.clock24h)}–${fmtTime(e.endAt, ctx.clock24h)}.` };
  }

  // "what week is it", "what week of the semester are we in"
  if (/^what week (?:is it|are we (?:in|on)|of the (?:semester|term|quarter) (?:is it|are we (?:in|on)))$/.test(q)) {
    const weekStart = addDays(startOfDay(now), -((now.getDay() - (ctx.weekStartsOn ?? 0) + 7) % 7));
    for (const c of ctx.categories) {
      const first = c.syllabus?.keyDates.find((k) => /\b(?:first day|classes (?:begin|start)|instruction begins|start of (?:classes|semester|term))\b/i.test(k.label));
      if (first) {
        const [y, mo, d] = first.date.split("-").map(Number);
        const week = Math.floor(differenceInCalendarDays(startOfDay(now), new Date(y, mo - 1, d)) / 7) + 1;
        if (week >= 1 && week <= 20) return { text: `It's ${bold(`week ${week}`)} of the semester — the week of ${format(weekStart, "MMM d")}.` };
      }
    }
    return { text: `It's the week of ${bold(format(weekStart, "MMMM d"))}.` };
  }
  return undefined;
}

function statsIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/\b(?:how productive|how (?:am|have) i (?:doing|been doing)|how did i do|my progress|progress report|how much (?:did i|have i) (?:get|gotten|got) done|completion rate|am i on track|am i keeping up|how am i keeping up)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  const weekStart = addDays(startOfDay(now), -((now.getDay() - (env.ctx.weekStartsOn ?? 0) + 7) % 7));
  const start = ref?.kind === "range" ? (ref.label === "this week" ? weekStart : ref.start) : ref?.kind === "day" ? ref.day : weekStart;
  const end = ref?.kind === "range" ? ref.end : ref?.kind === "day" ? addDays(ref.day, 1) : addDays(startOfDay(now), 1);
  const label = ref ? ref.label : "this week";
  const work = env.ctx.items.filter(isWork);
  const finished = work.filter((i) => i.status === "done" && +new Date(i.completedAt ?? i.at) >= +start && +new Date(i.completedAt ?? i.at) < +end);
  const dueSoFar = work.filter((i) => +new Date(i.at) >= +start && +new Date(i.at) < Math.min(+end, +now));
  const dueDone = dueSoFar.filter((i) => i.status === "done").length;
  const overdue = work.filter((i) => isOpen(i) && isOverdueAt(i, now));
  const early = finished.filter((i) => +new Date(i.at) >= +end).length;
  const parts: string[] = [];
  parts.push(finished.length ? `You've finished ${bold(plural(finished.length, "item"))} ${label}` : `You haven't checked anything off ${label} yet`);
  if (dueSoFar.length) parts.push(`${dueDone} of the ${dueSoFar.length} that came due ${dueDone === 1 ? "is" : "are"} done`);
  if (early) parts.push(`${early} ahead of schedule`);
  const tail = overdue.length
    ? ` You have ${bold(`${overdue.length} overdue`)}${overdue.length <= 2 ? ` (${joinNatural(overdue.map((i) => i.title))})` : ""} — clearing ${overdue.length === 1 ? "that" : "those"} would put you fully on track.`
    : dueSoFar.length || finished.length ? " Nothing is overdue — you're on track." : "";
  return { text: `${parts.join(", ")}.${tail}` };
}

function nowIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/^(?:what|which|am i|do i|who|is there|anything)\b.*\b(?:now|right now|currently|at the moment)\b|^what am i doing$|^am i in (?:a )?class(?: right now)?$/.test(q) && !/^(?:what class (?:do i have|am i in) now)$/.test(q)) return undefined;
  const live = happeningNow(ctx.items, now, ctx.categories);
  if (!live.length) {
    const next = ctx.items.filter((i) => i.type === "event" && !i.allDay && +new Date(i.at) > +now).sort(byAt)[0];
    return { text: `Nothing's happening right now.${next ? ` Next up is ${bold(next.title)} ${dayName(new Date(next.at), now)} at ${fmtTime(next.at, ctx.clock24h)}.` : ""}` };
  }
  const line = (i: Item) => `${bold(i.title)}${i.endAt ? ` (until ${fmtTime(i.endAt, ctx.clock24h)})` : ""}${i.location ? ` in ${i.location}` : ""}`;
  return { text: live.length === 1 ? `Right now you have ${line(live[0])}.` : `Right now you have ${joinNatural(live.map(line))}.` };
}

function firstLastIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m = /\b(first|earliest|last|latest)\s+(class|event|meeting|thing|appointment|lecture)\b/.exec(q);
  const ends = /\b(?:get out|out of|end|ends|finish|finishes|done with|over)\b/.test(q) && /\b(?:class|classes|school|today|tomorrow)\b/.test(q);
  if (!m && !ends) return undefined;
  if (!/^(?:when|what time|what is|what)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  if (ref && ref.kind !== "day") return undefined;
  const day = ref?.day ?? startOfDay(now);
  const label = ref?.label ?? "today";
  const wantsClass = !m || m[2] === "class" || m[2] === "lecture" || /\bclass/.test(q);
  const events = ctx.items
    .filter((i) => i.type === "event" && !i.allDay && itemOccupiesDay(i, day) && (!wantsClass || isClass(env, i)) && (m ? true : true))
    .sort(byAt);
  const kindWord = wantsClass ? "class" : m ? m[2] : "event";
  if (!events.length) return { text: `You don't have any ${kindWord}es ${label}.`.replace("classes", "classes").replace("evente", "event").replace("meetinges", "meetings") };
  const wantsLast = ends || /^(?:last|latest)$/.test(m?.[1] ?? "");
  const pickEv = wantsLast ? events[events.length - 1] : events[0];
  if (ends) {
    const end = pickEv.endAt ? new Date(pickEv.endAt) : new Date(pickEv.at);
    return { text: `Your last ${kindWord} ${label} is ${bold(pickEv.title)}, ${pickEv.endAt ? `which ends at ${bold(fmtTime(end, ctx.clock24h))}` : `starting at ${bold(fmtTime(end, ctx.clock24h))}`}.` };
  }
  const d = new Date(pickEv.at);
  return { text: `Your ${wantsLast ? "last" : "first"} ${kindWord} ${label} is ${bold(pickEv.title)} at ${bold(fmtTime(d, ctx.clock24h))}${pickEv.location ? ` in ${pickEv.location}` : ""}.` };
}

const WORK_START = 8;
const WORK_END = 22;

function freeIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const asksFree = /\b(?:am i (?:free|busy|available|open)|are we free|when am i (?:free|available|open)|when (?:am i )?(?:free|available)|free time|any free|do i have (?:any )?(?:free )?(?:time|room|space|a gap|gaps|openings?)|got (?:any )?time|when can i|what (?:time|times) (?:am i|are) (?:free|available)|open slots?|available slots?|am i (?:booked|packed)|free (?:at|on|this|tomorrow|today|tonight|after|before|between)|free\b.*\b(?:today|tomorrow|tonight))\b/.test(q);
  if (!asksFree) return undefined;
  if (/\b(?:add|schedule|create|book|move)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  if (ref && ref.kind === "range" && ref.end.getTime() - ref.start.getTime() > 8 * 86_400_000) return null;
  const time = findTime(q);
  const day = ref?.kind === "day" ? ref.day : ref?.kind === "range" ? ref.start : startOfDay(now);
  const label = ref?.kind === "day" ? ref.label : ref?.kind === "range" ? ref.label : "today";
  if (ref?.kind === "range") {
    const part = partOfDay(q);
    const rows: string[] = [];
    let open = 0;
    for (let d = ref.start < startOfDay(now) ? startOfDay(now) : ref.start; +d < +ref.end && rows.length < 7; d = addDays(d, 1)) {
      const gaps = freeGaps(env, d, part?.from ?? WORK_START, part?.to ?? WORK_END).filter(([a, b]) => +b - +a >= 60 * 60_000);
      const booked = busyBlocks(env, d).length;
      const dayLabel = dayName(d, now) === "today" || dayName(d, now) === "tomorrow" ? cap(dayName(d, now)) : format(d, "EEE, MMM d");
      if (!booked) {
        open += 1;
        rows.push(`- **${dayLabel}** — wide open`);
      } else if (gaps.length) {
        rows.push(`- **${dayLabel}** — ${gaps.slice(0, 3).map(([a, b]) => `${fmtTime(a, ctx.clock24h)}–${fmtTime(b, ctx.clock24h)}`).join(", ")}`);
      } else {
        rows.push(`- **${dayLabel}** — booked up`);
      }
    }
    if (!rows.length) return { text: `There's not much of ${label} left to plan around.` };
    return { text: `Here's your free time ${label}${part ? ` (${part.label}s)` : ""}${open ? ` — ${plural(open, "day")} completely open` : ""}:\n${rows.join("\n")}` };
  }

  const timed = ctx.items
    .filter((i) => i.type === "event" && !i.allDay && itemOccupiesDay(i, day))
    .map((i) => ({ item: i, start: new Date(i.at), end: i.endAt ? new Date(i.endAt) : addMinutes(new Date(i.at), 60) }))
    .map((e) => ({ ...e, start: e.start < startOfDay(day) ? startOfDay(day) : e.start }))
    .sort((a, b) => +a.start - +b.start);
  const allDay = ctx.items.filter((i) => i.type === "event" && i.allDay && itemOccupiesDay(i, day));

  if (time) {
    const at = atTime(day, time);
    const span = /\b(?:for|an?) (?:an? )?(?:hour|hr)\b|\bfor 1 ?h/.test(q) ? 60 : /\bfor (\d+) ?(?:min|minutes)\b/.test(q) ? +/for (\d+)/.exec(q)![1] : 30;
    const end = addMinutes(at, span);
    const clash = timed.filter((e) => +e.start < +end && +e.end > +at);
    if (!clash.length) {
      const after = timed.find((e) => +e.start >= +end);
      return { text: `Yes — nothing on your calendar at ${bold(fmtTime(at, ctx.clock24h))} ${label}.${after ? ` Your next thing after that is ${bold(after.item.title)} at ${fmtTime(after.start, ctx.clock24h)}.` : ""}` };
    }
    return { text: `Not quite — ${joinNatural(clash.map((e) => `${bold(e.item.title)} (${fmtTime(e.start, ctx.clock24h)}–${fmtTime(e.end, ctx.clock24h)})`))} ${clash.length === 1 ? "overlaps" : "overlap"} ${fmtTime(at, ctx.clock24h)} ${label}.` };
  }

  let from = WORK_START;
  let to = WORK_END;
  if (/\bmorning\b/.test(q)) { from = 8; to = 12; }
  else if (/\bafternoon\b/.test(q)) { from = 12; to = 17; }
  else if (/\b(?:evening|tonight|night)\b/.test(q)) { from = 17; to = 22; }
  let windowStart = atTime(day, { h: from, m: 0 });
  const windowEnd = atTime(day, { h: to, m: 0 });
  if (isSameDay(day, now) && +now > +windowStart) {
    windowStart = new Date(Math.ceil(+now / (15 * 60_000)) * 15 * 60_000);
    if (+windowStart >= +windowEnd) return { text: `There's not much of ${label === "today" ? "today" : label} left to plan around.` };
  }
  const gaps: Array<[Date, Date]> = [];
  let cursor = windowStart;
  for (const e of timed) {
    if (+e.end <= +cursor) continue;
    if (+e.start > +cursor) gaps.push([cursor, +e.start < +windowEnd ? e.start : windowEnd]);
    if (+e.end > +cursor) cursor = e.end;
    if (+cursor >= +windowEnd) break;
  }
  if (+cursor < +windowEnd) gaps.push([cursor, windowEnd]);
  const real = gaps.filter(([a, b]) => +b - +a >= 45 * 60_000);
  const allDayNote = allDay.length ? ` You do have ${joinNatural(allDay.map((a) => bold(a.title)))} on all day.` : "";
  if (!timed.length) return { text: `${cap(label)} is wide open — nothing timed on your calendar.${allDayNote}` };
  if (!real.length) return { text: `${cap(label)} is pretty packed — I don't see a gap longer than 45 minutes.` };
  const part = /\bmorning\b/.test(q) ? "morning" : /\bafternoon\b/.test(q) ? "afternoon" : /\b(?:evening|tonight|night)\b/.test(q) ? "evening" : "";
  const spans = real.map(([a, b]) => (+b >= +windowEnd && to === WORK_END && !part ? `after ${bold(fmtTime(a, ctx.clock24h))}` : bold(`${fmtTime(a, ctx.clock24h)}–${fmtTime(b, ctx.clock24h)}`)));
  const head = part ? (label === "today" ? `This ${part}` : `${cap(label)} ${part}`) : cap(label);
  return { text: `${head} you're free ${joinNatural(spans)}.${allDayNote}` };
}

function busiestIntent(env: Env): Outcome {
  const { q, now } = env;
  const busiest = /\b(?:busiest|heaviest|most packed|most loaded|most (?:hectic|crowded|stacked)|busy day)\b/.test(q);
  const lightest = /\b(?:lightest|quietest|easiest|least busy|emptiest|freest|calmest|slowest)\b/.test(q);
  if (!busiest && !lightest) return undefined;
  const ref = findDayRef(q, now);
  const range = ref?.kind === "range" ? ref : { kind: "range" as const, start: startOfDay(now), end: addDays(startOfDay(now), 7), label: ref ? "" : "this week", text: "" };
  if (ref?.kind === "day") return undefined;
  const label = range.label || "this week";
  const counts = new Map<number, { day: Date; n: number; titles: string[] }>();
  for (let d = range.start; d < range.end; d = addDays(d, 1)) {
    if (d < startOfDay(now)) continue;
    const c = collectDay(env, d, {});
    const list = [...c.events.map((e) => e.title), ...c.openWork.map((w) => w.title)];
    counts.set(+d, { day: d, n: list.length, titles: list });
  }
  const rows = [...counts.values()];
  if (!rows.length || rows.every((r) => r.n === 0)) return { text: `Nothing on your calendar ${label}.` };
  const sorted = rows.sort((a, b) => (busiest ? b.n - a.n : a.n - b.n) || +a.day - +b.day);
  const top = sorted[0];
  if (lightest && top.n === 0) return { text: `${bold(longDay(top.day, now).replace(/^./, (c) => c.toUpperCase()))} is completely clear — your lightest day ${label}.` };
  return { text: `${bold(cap(longDay(top.day, now)))} is your ${busiest ? "busiest" : "lightest"} day ${label} — ${bold(plural(top.n, "thing"))}${top.titles.length ? `: ${joinNatural(top.titles.slice(0, 4).map(bold))}${top.titles.length > 4 ? `, +${top.titles.length - 4} more` : ""}` : ""}.` };
}

function weekSummaryIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/\b(?:how (?:is|does|do|are)|how busy|how packed|how heavy|how loaded|am i (?:busy|swamped|slammed))\b/.test(q) && !/\blook like\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  if (!ref) return /\bhow busy\b/.test(q) ? weekTotals(env, { kind: "range", start: startOfDay(now), end: addDays(startOfDay(now), 7 - startOfDay(now).getDay()), label: "this week", text: "" }) : undefined;
  if (ref.kind === "day") return dayAnswer(env, ref, {});
  return weekTotals(env, ref);
}

function weekTotals(env: Env, ref: Extract<DayRef, { kind: "range" }>): AssistantResponse {
  const { now } = env;
  let events = 0;
  let due = 0;
  let top: { day: Date; n: number } | null = null;
  for (let d = ref.start < startOfDay(now) ? startOfDay(now) : ref.start; d < ref.end; d = addDays(d, 1)) {
    const c = collectDay(env, d, {});
    events += c.events.length;
    due += c.openWork.length;
    const n = c.events.length + c.openWork.length;
    if (n && (!top || n > top.n)) top = { day: d, n };
  }
  if (!events && !due) return { text: `${cap(ref.label)} is clear — nothing scheduled or due.` };
  const parts = [events ? plural(events, "event") : "", due ? `${due} due` : ""].filter(Boolean);
  return { text: `${cap(ref.label)} you have ${bold(joinNatural(parts))}${top ? `. ${bold(cap(longDay(top.day, now)))} is the heaviest day with ${top.n}` : ""}.` };
}

function countIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/^(?:how many|number of|count)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  const cls = findClass(env, q);
  const opts = refineOpts(q, cls);
  const kind = /\bassignments?\b|\bhomework\b|\bhw\b/.test(q) ? "assignment" : /\btasks?\b|\bto-?dos?\b/.test(q) ? "task" : undefined;
  if (opts.only === "classes" && ref?.kind === "day") {
    const c = collectDay(env, ref.day, opts);
    const n = c.events.length + c.ended.length;
    return { text: n ? `You have ${bold(plural(n, "class", "classes"))} ${ref.label}.` : `No classes ${ref.label}.` };
  }
  if (opts.only === "events" || (opts.only === undefined && /\b(?:things|items|stuff)\b/.test(q) && ref)) {
    if (!ref) {
      const n = inClass(env, env.ctx.items.filter((i) => i.type === "event" && +new Date(i.at) >= +startOfDay(now)), cls).length;
      return { text: `You have ${bold(plural(n, "upcoming event"))}.` };
    }
    const days = ref.kind === "day" ? [ref.day] : Array.from({ length: Math.min(14, differenceInCalendarDays(ref.end, ref.start)) }, (_, i) => addDays(ref.start, i));
    const label = ref.label;
    let ev = 0;
    let due = 0;
    for (const d of days) {
      const c = collectDay(env, d, { cls });
      ev += c.events.length + c.ended.length;
      due += c.openWork.length;
    }
    if (opts.only === "events") return { text: ev ? `You have ${bold(plural(ev, "event"))} ${label}.` : `No events ${label}.` };
    return { text: ev + due ? `You have ${bold(plural(ev + due, "thing"))} ${label}${ev && due ? ` — ${ev} ${ev === 1 ? "event" : "events"} and ${due} due` : ""}.` : `Nothing ${label}.` };
  }
  const open = inClass(env, env.ctx.items.filter((i) => isOpen(i) && (!kind || i.type === kind)), cls);
  let pool = open;
  let label = "open";
  const by = /\b(?:by|before|through|until)\b/.test(q) && ref?.kind === "day";
  if (ref?.kind === "day") {
    pool = by ? open.filter((i) => +new Date(i.at) < +addDays(ref.day, 1)) : open.filter((i) => isDueOnDay(i, ref.day));
    label = by ? `due by ${ref.label}` : `due ${ref.label}`;
  } else if (ref?.kind === "range") {
    pool = open.filter((i) => +new Date(i.at) >= +ref.start && +new Date(i.at) < +ref.end);
    label = `due ${ref.label}`;
  }
  const noun = kind ?? "item";
  const suffix = cls ? ` for ${cls.name}` : "";
  if (!pool.length) return { text: `Nothing ${label}${suffix}.` };
  const list = pool.slice().sort(byAt);
  return { text: `You have ${bold(`${pool.length} ${pool.length === 1 ? noun : `${noun}s`}`)} ${label}${suffix}${pool.length <= 4 ? `: ${joinNatural(list.map((i) => bold(i.title)))}` : ""}.` };
}

function classScheduleAnswer(env: Env, cls: Category, kind: "when" | "where"): AssistantResponse | null {
  const { now, ctx } = env;
  const meetings = ctx.items.filter((i) => i.categoryId === cls.id && i.type === "event" && !i.allDay && isClass(env, i)).sort(byAt);
  const upcoming = meetings.filter((i) => +new Date(i.endAt ?? i.at) >= +now);
  if (!upcoming.length) return null;
  const saved = savedClassMeetings(ctx.items, cls.id);
  const patterns = new Set<string>();
  for (const i of upcoming.slice(0, 16)) {
    const d = new Date(i.at);
    patterns.add(`${format(d, "EEE")} ${fmtTime(d, ctx.clock24h)}${i.endAt ? `–${fmtTime(i.endAt, ctx.clock24h)}` : ""}`);
  }
  const summary = saved.length ? saved.map((m) => formatMeetingSummary(m, ctx.clock24h)).join(" and ") : [...patterns].slice(0, 3).join(" and ");
  const next = upcoming[0];
  const nd = new Date(next.at);
  const loc = next.location;
  if (kind === "where") return loc ? { text: `${bold(cls.classTitle || cls.name)} meets in ${bold(loc)}.` } : null;
  return { text: `${bold(cls.classTitle || cls.name)} meets ${summary}${loc ? ` in ${loc}` : ""}. The next one is ${bold(dayName(nd, now))} at ${bold(fmtTime(nd, ctx.clock24h))}.` };
}

function lookupIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m =
    /^(when|what time|where|what day|which day|what date)\s+(?:is|are|does|do|did|will|was)?\s*(?:my|the|our|that)?\s*(.+)$/.exec(q) ??
    /^(?:where|when) (?:do i|does)\s+(?:my\s+|the\s+)?(.+?)\s+(?:meet|start|begin|end|happen|take place)$/.exec(q);
  if (!m) return undefined;
  const wh = m[1];
  const kind: "where" | "when" = /^where/.test(wh) || /^where/.test(q) ? "where" : "when";
  const rawPhrase = m[2] ?? m[1];
  const phraseRef = findDayRef(rawPhrase, now);
  const trailing = /\b(?:due|start|starts|begin|begins|end|ends|happening|scheduled|meet|meets|held|take place|takes place|taking place|again|going to be|at)\s*$/g;
  let phrase = (phraseRef ? rawPhrase.replace(phraseRef.text, " ") : rawPhrase).replace(/\s+/g, " ").trim().replace(trailing, "").trim().replace(trailing, "").trim();
  phrase = phrase.replace(/^(?:my|the)\s+/, "").trim();
  if (phraseRef) phrase = `${phrase} ${phraseRef.text}`;
  // "when's the lecture" / "when is class" — the next class meeting.
  if (/^(?:class|lecture|classes|lectures)(?: \S+)?$/.test(phrase) && !phraseRef) {
    const nextClass = ctx.items.filter((i) => i.type === "event" && !i.allDay && isClass(env, i) && +new Date(i.endAt ?? i.at) >= +now).sort(byAt)[0];
    if (!nextClass) return null;
    const d = new Date(nextClass.at);
    return { text: `Your next class is ${bold(nextClass.title)} ${dayName(d, now)} at ${bold(fmtTime(d, ctx.clock24h))}${nextClass.location ? ` in ${nextClass.location}` : ""}.` };
  }
  if (!phrase || PRONOUN_ONLY.test(phrase)) return null;
  if (/\b(?:free|busy|available|open)\b/.test(phrase) || /\bam i\b|\bdo i\b|\bcan i\b|\bshould i\b/.test(phrase)) return undefined;

  const cls = findClass(env, phrase);
  const bareClass = cls && tokens(phrase.replace(/\b(?:class|lecture|section|lab|meeting|meets?)\b/g, "")).every((t) => tokenMatches(t, categoryTokens(cls)));
  if (cls && bareClass) return classScheduleAnswer(env, cls, kind) ?? null;

  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return undefined;
  if (target.kind === "many") {
    const items = target.items.filter((i) => +new Date(i.at) >= +startOfDay(now) || i.status !== "done");
    if (items.length < 2 || items.length > 5) return null;
    return { text: `A few things match:\n${bullets(items.map((i) => `${bold(i.title)} — ${i.type === "event" ? "" : "due "}${describeWhen(env, i)}${kind === "where" && i.location ? ` · ${i.location}` : ""}`), 5)}` };
  }
  const { item, series } = target;
  const d = new Date(item.at);
  if (kind === "where") {
    return { text: item.location ? `${bold(item.title)} is at ${bold(item.location)}${item.type === "event" ? `, ${describeWhen(env, item)}` : ""}.` : `I don't have a location saved for ${bold(item.title)}.` };
  }
  const eod = d.getHours() === 23 && d.getMinutes() === 59;
  const timeText = item.allDay || (item.type !== "event" && eod) ? "" : ` at ${bold(fmtTime(d, ctx.clock24h))}`;
  const rel = relative(d, now);
  const askedEnd = /\b(?:end|ends|finish|over)\b/.test(q);
  if (item.type === "event" && askedEnd && item.endAt) return { text: `${bold(item.title)} ends at ${bold(fmtTime(item.endAt, ctx.clock24h))} ${dayName(d, now)}.` };
  const seriesNote = series > 1 ? ` That's the next one — it repeats.` : "";
  const relNote = /^(?:today|tomorrow|yesterday)$/.test(dayName(d, now)) ? "" : ` (${rel})`;
  if (item.type !== "event") {
    if (item.status === "done") return { text: `${bold(item.title)} was due ${bold(dayName(d, now))}${timeText}, and you've already marked it done.` };
    const overdue = isOverdueAt(item, now);
    return { text: `${bold(item.title)} ${overdue ? "was due" : "is due"} ${bold(dayName(d, now))}${timeText}${relNote}.${overdue ? " That's overdue." : ""}` };
  }
  const whereNote = item.location ? ` in ${item.location}` : "";
  const tense = +d < +now && !isEventEnded(item, now, d) ? "started" : +d < +now ? "was" : "is";
  return { text: `${bold(item.title)} ${tense} ${bold(dayName(d, now))}${item.allDay ? " (all day)" : timeText}${whereNote}${relNote}.${seriesNote}` };
}

function focusIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/^(?:what|which)\s+(?:should|do) i\s+(?:work on|do|tackle|start with|focus on|knock out|get done|handle)(?:\s+(?:first|next|now|today|tonight|this week))?$/.test(q) && !/^(?:what is|what's)?\s*(?:the )?(?:most )?(?:urgent|important|pressing)(?: thing)?(?: to do)?$/.test(q)) return undefined;
  const open = env.ctx.items.filter(isOpen).sort(byAt);
  if (!open.length) return { text: "Nothing outstanding — you're all caught up, so you're free to get ahead on something." };
  const overdue = open.filter((i) => isOverdueAt(i, now));
  const ahead = open.filter((i) => !isOverdueAt(i, now));
  const first = overdue[0] ?? ahead[0];
  const rest = [...overdue.slice(overdue[0] ? 1 : 0), ...(overdue[0] ? ahead : ahead.slice(1))].slice(0, 2);
  const why = overdue[0] ? `it was due ${dayName(new Date(first.at), now)}` : `it's due ${dayName(new Date(first.at), now)}`;
  return { text: `I'd start with ${bold(first.title)} — ${why}.${rest.length ? ` After that: ${joinNatural(rest.map((i) => `${bold(i.title)} (${dayName(new Date(i.at), now)})`))}.` : ""}` };
}

const GENERIC_KIND: Record<string, RegExp> = {
  exam: /\b(?:exams?|midterms?|finals?|tests?)\b/i,
  quiz: /\bquiz(?:zes)?\b/i,
  midterm: /\bmidterms?\b/i,
  final: /\bfinals?\b/i,
  test: /\btests?\b/i,
  homework: /\b(?:homework|hw|problem sets?|psets?)\b/i,
  project: /\bprojects?\b/i,
  paper: /\b(?:papers?|essays?)\b/i,
  essay: /\b(?:papers?|essays?)\b/i,
  lab: /\blabs?\b/i,
  meeting: /\bmeetings?\b/i,
  appointment: /\bappointments?\b/i,
};

function searchIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m = /^(?:do i have|have i got|is there|are there|got|any)\s+(?:an?\s+|any\s+|anything\s+(?:about\s+|for\s+|called\s+|with\s+)?|something\s+(?:about|for)\s+)?(.+)$/.exec(q);
  if (!m) return undefined;
  let phrase = m[1];
  if (/^(?:after|before|later|else|left|tonight|going on|happening|this (?:morning|afternoon|evening))\b/.test(phrase)) return undefined;
  if (/\b(?:free|time|room|space|gap|gaps|openings?|questions?|idea|problem|issue|to do|curve)\b/.test(phrase) || /^(?:due|overdue|stuff|things|classes|class|plans?|homework|assignments?|tasks?|events?)\b/.test(phrase) && !/\b(?:for|in)\b/.test(phrase)) {
    return undefined;
  }
  const ref = findDayRef(phrase, now);
  if (ref) phrase = phrase.replace(ref.text, " ");
  phrase = phrase.replace(/\b(?:coming up|upcoming|soon|scheduled|on my calendar|this semester|due)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!phrase) return undefined;
  const generic = GENERIC_KIND[phrase.replace(/s$/, "")] ?? null;
  const since = startOfDay(now);
  let hits: Item[];
  if (generic) {
    hits = ctx.items.filter((i) => generic.test(i.title) && (i.type === "event" ? +new Date(i.endAt ?? i.at) >= +since : i.status !== "done" && +new Date(i.at) >= +since)).sort(byAt);
    if (ref?.kind === "day") hits = hits.filter((i) => (i.type === "event" ? itemOccupiesDay(i, ref.day) : isDueOnDay(i, ref.day)));
    if (ref?.kind === "range") hits = hits.filter((i) => +new Date(i.at) >= +ref.start && +new Date(i.at) < +ref.end);
  } else {
    const t = resolveTarget(env, `${phrase}${ref ? ` ${ref.text}` : ""}`, "any");
    if (t.kind === "none") hits = [];
    else if (t.kind === "one") hits = [t.item];
    else hits = t.items;
    hits = hits.filter((i) => (i.type === "event" ? +new Date(i.endAt ?? i.at) >= +since : i.status !== "done" || +new Date(i.at) >= +since)).sort(byAt);
  }
  const noun = phrase.replace(/s$/, "") === phrase ? phrase : phrase;
  if (!hits.length) return { text: `I don't see any ${bold(noun)} coming up${ref ? ` ${ref.label}` : ""}.` };
  const line = (i: Item) => `${bold(i.title)} — ${i.type === "event" ? "" : "due "}${describeWhen(env, i)}${i.location ? ` · ${i.location}` : ""}`;
  if (hits.length === 1) return { text: `Yes — ${line(hits[0])}.`.replace(" — ", " is ").replace(/^Yes is /, "Yes — ") };
  if (hits.length <= 3) return { text: `Yes, ${hits.length} of them:\n${bullets(hits.map(line), 5)}` };
  return { text: `Yes — ${bold(`${hits.length} matches`)}. The next few:\n${bullets(hits.slice(0, 4).map(line), 4)}` };
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

/** Words that mean the user wants reasoning, not a lookup. Always the model's job. */
const NEEDS_REASONING =
  /\b(?:should i|recommend|suggest(?:ions?)?|advice|prioriti[sz]e|plan my|plan out|study plan|help me (?:plan|study|prepare|organi[sz]e|balance|decide|figure|manage)|summari[sz]e|explain|overwhelm(?:ed|ing)?|stress(?:ed|ful)?|worried|too much|too busy|realistic|workload|how (?:can|do) i (?:manage|balance|fit|catch up)|procrastinat\w*|motivat\w*|brainstorm|write me|write (?:a|an)|draft (?:me|a|an)|compose|rewrite|reschedule everything|rearrange)\b|^(?:why|compare)\b/;
/** General-knowledge asks — nothing on the calendar can answer these. */
const OFF_TOPIC = /\b(?:weather|forecast|temperature|rain(?:ing|y)?|snow(?:ing|y)?|humid|news|headlines|stocks?|who won|scores? of|recipe|translate|definition|define|meaning of|capital of|how do you spell|joke|poem|story|song|lyrics|calculate|solve|equation|derivative|integral|trivia|fun fact)\b/;

/** Reasoning-flavoured phrasings we can still answer exactly. */
const REASONING_OK = /^(?:what|which) (?:should|do) i (?:work on|do|tackle|start with|focus on)|^when (?:should|can|could) i (?:work on|study for|study|do|start|finish|get to)\b|\bshould i (?:bring|buy)\b/;

const ACTION_VERB = "(?:mark|move|delete|add|remove|complete|reschedule|push|cancel|rename|finish|start|remind|set|change|schedule|block|find|create|book|put|reopen|postpone|check off)";
const COMPOUND_SPLIT = new RegExp(String.raw`\s*;\s*|,?\s+(?:and then|then|and also|also)\s+|,?\s+and\s+(?=${ACTION_VERB}\b)|,\s+(?=${ACTION_VERB}\b)`);
const FOLLOW_UP = /^(?:and\s+|what about\s+|how about\s+|what of\s+|and what about\s+|then\s+)(.+)$/;

function questionNeedsContext(q: string): boolean {
  return /\b(?:same|instead|the other|another one|before that|after that|earlier one|later one|previous)\b/.test(q);
}

function run(env: Env): Outcome {
  const pipeline: Array<(e: Env) => Outcome> = [
    smallTalk,
    (e) => answerHelpQuestion(e.q),
    syllabusIntent,
    plannerIntent,
    reminderIntent,
    fieldEditIntent,
    moveIntent,
    deleteIntent,
    renameIntent,
    completeIntent,
    addIntent,
    focusIntent,
    statsIntent,
    classesIntent,
    dateMathIntent,
    freeIntent,
    busiestIntent,
    whereNextIntent,
    nextIntent,
    nowIntent,
    firstLastIntent,
    overdueIntent,
    didIFinishIntent,
    progressIntent,
    completedIntent,
    countIntent,
    lookupIntent,
    weekSummaryIntent,
    searchIntent,
    agendaIntent,
  ];
  for (const step of pipeline) {
    const out = step(env);
    if (out !== undefined) return out;
  }
  return undefined;
}

function syllabusIntent(env: Env): Outcome {
  // Questions about a specific item ("when is my meeting with professor lee")
  // are calendar lookups, not syllabus ones.
  if (/^(?:when|what time)\b/.test(env.q) && /\b(?:meeting|appointment|exam|quiz|midterm|final|due)\b/.test(env.q)) return undefined;
  const out = answerSyllabusQuestion({
    q: env.q,
    raw: env.raw.toLowerCase(),
    now: env.now,
    categories: env.ctx.categories,
    named: findClass(env, env.q),
  });
  const cls = out && /(?:What do you want to know|Which one do you want)\?$/.test(out.text) ? /\*\*(.+?)\*\*/.exec(out.text)?.[1] : undefined;
  if (out && cls) pendingSyllabus = { prompt: out.text, className: cls };
  return out;
}

function isMutation(r: AssistantResponse): boolean {
  return Boolean(r.actions?.length);
}

const CONFIRM_TAIL = /\s*(?:—\s*)?confirm(?: each)? below(?: and it's checked off)?\.?\s*$/i;

/** Titles the last reply was about, in order: the "it" in "move it to friday". */
function recentSubjects(history: AssistantTurn[], ctx: AssistantCtx): string[] {
  const last = [...history].reverse().find((t) => t.role === "assistant");
  if (!last) return [];
  const titles = new Map(ctx.items.map((i) => [i.title.toLowerCase(), i.title]));
  const out: string[] = [];
  for (const m of last.text.matchAll(/\*\*(.+?)\*\*/g)) {
    const title = titles.get(m[1].trim().toLowerCase());
    if (title && !out.includes(title)) out.push(title);
  }
  return out;
}

const EDIT_HEAD = /^(?:mark|move|reschedule|push|bump|shift|postpone|delay|delete|remove|cancel|rename|complete|finish|start|reopen|change|set|put|check off|remind me about|add (?:a )?reminder (?:to|for)|(?:block|find|schedule|set aside|carve out|plan|reserve|make) (?:off |out )?(?:\S+ ){0,6}(?:for|to (?:work on|study for|do|finish|start))|i (?:just )?(?:finished|did|submitted|turned in)|done with|finished with)\b/;

/**
 * Swap "it" / "them" for what the last reply was about. Only in edits and in
 * "when/where is it" questions, and only when that subject is unambiguous.
 */
function resolvePronouns(n: string, q: string, subjects: string[]): { n: string; q: string } | null {
  const isEdit = EDIT_HEAD.test(q) || /^(?:it|that|they|those|both)(?: one)? (?:is|are|was|were) (?:all )?(?:done|finished|complete|completed|submitted)$/.test(q);
  const isAsk = /^(?:when|where|what time|how long) (?:is|was|does|did|will) (?:it|that)\b/.test(q) && !/^what time is it$/.test(q);
  if (!isEdit && !isAsk) return { n, q };
  const plural = /\b(?:them|those|these|both(?: of them)?|all of them|they)\b/;
  const single = /\b(?:it|that one|this one|that|this)\b(?!\s+(?:is due|was due))/;
  const re = plural.test(q) ? plural : single.test(q) ? single : null;
  if (!re) return { n, q };
  if (!subjects.length) return null;
  if (re === single && subjects.length !== 1) return null;
  const replacement = re === plural ? subjects.join(" and ") : subjects[0];
  const reN = new RegExp(re.source, "i");
  return { n: n.replace(reN, replacement), q: q.replace(re, replacement.toLowerCase()) };
}

function mergeResponses(parts: AssistantResponse[]): AssistantResponse {
  const actions = parts.flatMap((p) => p.actions ?? []);
  const text = parts
    .map((p) => p.text.replace(CONFIRM_TAIL, "").replace(/[.\s]*$/, "."))
    .join(" ");
  return { text: actions.length ? `${text} Confirm below.` : text, ...(actions.length ? { actions } : {}) };
}

/**
 * Answer from the calendar on this device, or return `null` to let the model
 * have it. Anything ambiguous, advisory, or context-dependent that we can't
 * resolve exactly is `null` on purpose.
 */
export function tryLocalAnswer(
  message: string,
  history: AssistantTurn[],
  ctx: AssistantCtx,
  now: Date = new Date(),
  depth = 0
): AssistantResponse | null {
  const raw = message.trim();
  if (!raw || raw.length > 400) return null;
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant");

  // The user is answering our "which one do you mean?".
  if (depth === 0 && pendingChoice) {
    const choice = pendingChoice;
    pendingChoice = null;
    if (lastAssistant?.text === choice.prompt) {
      const q0 = expand(normalize(raw) || raw);
      const picked = pickOption({ ctx, now, raw, n: q0, q: q0, history }, choice.options);
      if (picked) return choice.build(picked, 1);
      if (q0.split(" ").length <= 4) return null;
    }
  }

  // "the late policy" after we asked what they want to know from a syllabus.
  if (depth === 0 && pendingSyllabus) {
    const follow = pendingSyllabus;
    pendingSyllabus = null;
    if (lastAssistant?.text === follow.prompt && raw.split(/\s+/).length <= 8) {
      const topic = expand(normalize(raw) || raw);
      if (!/^(?:what|when|where|who|how|is|are|can|do|does)\b/.test(topic)) {
        const asked = tryLocalAnswer(`what does the ${follow.className.toLowerCase()} syllabus say about ${topic}`, [], ctx, now, 1);
        return asked;
      }
    }
  }

  if (/\n/.test(raw) || raw.length > 160) {
    const list = pastedListIntent({ ctx, now, raw, n: raw, q: expand(raw), history });
    return list ?? null;
  }

  let n = normalize(raw);
  // "thanks!" is all filler — keep it so small talk can answer it.
  if (!n) n = raw.replace(/[?!.]+$/, "").trim();
  if (!n) return null;
  let q = expand(n);

  if (NEEDS_REASONING.test(q) && !REASONING_OK.test(q)) return null;
  if (OFF_TOPIC.test(q)) return null;

  if (depth === 0) {
    const resolved = resolvePronouns(n, q, recentSubjects(history, ctx));
    if (!resolved) return null;
    n = resolved.n;
    q = resolved.q;
  }
  if (questionNeedsContext(q)) return null;

  // "mark the essay done and move problem set 4 to friday" — each part must stand on its own.
  if (depth === 0) {
    const parts = n.split(COMPOUND_SPLIT).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4) {
      const answers: AssistantResponse[] = [];
      for (const part of parts) {
        const a = tryLocalAnswer(part, history, ctx, now, 1);
        if (!a || /\?\s*$/.test(a.text)) return null;
        answers.push(a);
      }
      return mergeResponses(answers);
    }
  }

  const env: Env = { ctx, now, raw, n, q, history };

  // A short reply to a question the assistant asked needs the thread.
  if (depth === 0 && lastAssistant && /\?\s*$/.test(lastAssistant.text) && q.split(" ").length <= 5 && !/^(?:what|when|where|who|which|how|do|did|am|is|are|can|add|move|delete|mark|show|list|push|cancel|rename|remind|block|find)\b/.test(q) && !/^(?:hi|hey|hello|thanks|thank you|ok|okay)$/.test(q)) {
    return null;
  }

  // "what about friday?" — the previous question again, with a new day.
  const followUp = FOLLOW_UP.exec(q);
  if (followUp && depth === 0) {
    const ref = findDayRef(followUp[1], now);
    const cls = findClass(env, followUp[1]);
    const prev = [...history].reverse().find((t) => t.role === "user");
    if ((!ref && !cls) || !prev) return null;
    const prevQ = expand(normalize(prev.text));
    if (/^(?:add|create|move|delete|remove|cancel|rename|mark|schedule|push|remind|reschedule|block|find)/.test(prevQ)) return null;
    let merged = prevQ;
    if (ref) {
      const prevRef = findDayRef(prevQ, now);
      merged = prevRef ? merged.replace(prevRef.text, ref.text) : `${merged} ${ref.text}`;
    }
    if (cls) {
      const prevCls = findClass(env, prevQ);
      merged = prevCls ? merged.replace(new RegExp(prevCls.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), cls.name.toLowerCase()) : `${merged} for ${cls.name.toLowerCase()}`;
    }
    const result = tryLocalAnswer(merged, history, ctx, now, 1);
    return result && !isMutation(result) ? result : null;
  }

  const out = run(env);
  if (!out) return null;
  // A new answer replaces any "which one?" still waiting, except the one it just asked.
  if (pendingChoice && pendingChoice.prompt !== out.text) pendingChoice = null;
  return out;
}

/**
 * How long a local answer waits before it lands. Model replies take a beat; an
 * instant one reads as canned. Scales lightly with length and never blocks.
 */
export function localReplyDelayMs(text: string, seed = text): number {
  const base = 420 + Math.min(text.length, 240) * 2.2;
  const jitter = (hash(seed) % 240) - 60;
  return Math.round(Math.min(1100, Math.max(380, base + jitter)));
}
