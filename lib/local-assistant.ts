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
import {
  formatMeetingSummary,
  formatTimeRange,
  isClassMeeting,
  meetingDateTimes,
  parseClassSchedule,
  savedClassMeetings,
  savedMeetingSlotEqual,
  scheduleRepeat,
  weekdayShort,
} from "./class-schedule";
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
import { findOverlapGroups } from "./overlap";
import { formatOffsetLabel } from "./reminder-defaults";
import { answerHelpQuestion } from "./local-help";
import { answerSyllabusQuestion } from "./local-syllabus";
import { findComponent, letterFloor, letterFor, neededScore, weightedSoFar, weightFraction } from "./local-grades";
import { answerMath } from "./local-math";
import { draftEmail, recipient, type EmailKind } from "./local-writing";
import type { SyllabusGradeCutoff } from "./syllabus-info";
import { isSyllabusSourceUid } from "./syllabus-match";
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
  pendingGrade = null;
  pendingAdd = null;
}

/** Ask which of a few matches was meant; more than a handful is the model's job. */
function askWhich(env: Env, items: Item[], build?: Build): AssistantResponse | null {
  if (items.length > 6) return null;
  const options = items.map((i) => `${bold(i.title)} (${describeWhen(env, i)})`);
  const last = options.pop();
  const text = `Which one do you mean — ${options.length ? `${options.join(", ")} or ${last}` : last}?`;
  if (build) pendingChoice = { prompt: text, options: items, build };
  return { text };
}

const ORDINALS: Record<string, number> = { first: 0, "1st": 0, one: 0, second: 1, "2nd": 1, two: 1, third: 2, "3rd": 2, three: 2, fourth: 3, "4th": 3, four: 3, fifth: 4, "5th": 4, five: 4, sixth: 5, "6th": 5, six: 5 };

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
  const ord = /^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|sixth|6th|one|two|three|four|five|six)(?: one)?$/.exec(q) ?? /^#?([1-6])$/.exec(q);
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
    return { text: "I can answer questions about your calendar — what's on a day, what's due, when you're free, when a class meets — and make changes for you: add, move, rename, complete, or delete items. I can also plan study time before an exam, draft an email to a professor, work out what you need on a final, and answer questions from your syllabus. Just say it however you'd say it to a person, and I'll ask you to confirm before anything changes." };
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
  // No date, or an event with no time: ask, never guess "today" or a time.
  const timed = HAS_TIME.test(stripped);
  const explicitAdd = /^(?:add|create|schedule|new|put|book|set up|remind me)\b/.test(q);
  const missing = !parsed.confidence.date ? "when" : parsed.type === "event" && !isTask && !parsed.allDay && !timed ? "time" : null;
  if (missing === "when" && (!explicitAdd || timed || parsed.repeat)) return null;
  // "add a meeting at 3" — the parser treats the only noun as filler and leaves "Untitled".
  const bareNoun = /^untitled$/i.test(parsed.title) ? /\b(meeting|appointment|event|call|interview|session)\b/i.exec(stripped)?.[1] : undefined;
  if (bareNoun) parsed.title = bareNoun;
  const title = parsed.title.replace(/^(?:a|an|the)\s+/i, "").trim();
  if (!titleIsFaithful(stripped, parsed.title, parsed.location, ctx.categories.find((c) => c.id === parsed.categoryId))) return null;
  if (!title || title.length > 90 || title.split(/\s+/).length > 12) return null;
  if (!bareNoun && /^(?:a |the )?(?:reminder|event|task|assignment|meeting)$/i.test(title)) return null;
  if (missing === "when" && /^(?:some ?thing|stuff|things?|anything|it|that|this|one)\b|\b(?:later|sometime|soon|eventually|at some point)\b/i.test(title)) return null;
  if (missing) {
    const shown = bold(title.charAt(0).toUpperCase() + title.slice(1));
    let text: string;
    if (missing === "time") {
      const d = dayName(parsed.at, now);
      text = `What time is ${shown} ${/^(?:today|tomorrow|tonight)$/.test(d) ? d : `on ${d}`}?`;
    } else if (/^remind me\b/.test(q)) text = `When should I remind you to ${title.charAt(0).toLowerCase()}${title.slice(1)}?`;
    else text = parsed.type === "event" && !isTask ? `When is ${shown}?` : `When is ${shown} due?`;
    pendingAdd = { prompt: text, text: n };
    return { text };
  }

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
/* Phase 3: plans, judgement calls with one right answer, more edits  */
/* ------------------------------------------------------------------ */

/** Rough time a piece of work takes — only used to size planned blocks and workload. */
function estimateMinutes(item: Item): number {
  const t = item.title.toLowerCase();
  if (/\b(?:exam|midterm|final|test)\b/.test(t)) return 120;
  if (/\b(?:project|paper|essay|report|presentation|thesis)\b/.test(t)) return 120;
  if (item.type === "task") return 30;
  if (/\b(?:quiz|reading|response|discussion|post|reflection|worksheet)\b/.test(t)) return 45;
  return 60;
}

function hoursText(minutes: number): string {
  const h = Math.round((minutes / 60) * 2) / 2;
  if (h < 1) return `${Math.max(15, Math.round(minutes / 15) * 15)} minutes`;
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** Free stretches on `day` with extra blocks (already planned in this reply) taken out. */
function openSlots(env: Env, day: Date, taken: Array<[Date, Date]>, from = WORK_START, to = WORK_END): Array<[Date, Date]> {
  let gaps = freeGaps(env, day, from, to);
  for (const [a, b] of taken) {
    const next: Array<[Date, Date]> = [];
    for (const [s, e] of gaps) {
      if (+b <= +s || +a >= +e) next.push([s, e]);
      else {
        if (+a > +s) next.push([s, a]);
        if (+b < +e) next.push([b, e]);
      }
    }
    gaps = next;
  }
  return gaps;
}

function weekRange(now: Date, weekStartsOn: 0 | 1): { start: Date; end: Date } {
  const today = startOfDay(now);
  const toWeekEnd = ((weekStartsOn === 1 ? 0 : 6) - today.getDay() + 7) % 7;
  return { start: today, end: addDays(today, toWeekEnd + 1) };
}

function planRange(env: Env, q: string): { start: Date; end: Date; label: string } {
  const today = startOfDay(env.now);
  const ref = findDayRef(q, env.now);
  if (ref?.kind === "day") return { start: ref.day, end: addDays(ref.day, 1), label: ref.label };
  if (ref?.kind === "range") return { start: ref.start < today ? today : ref.start, end: ref.end, label: ref.label };
  if (/\bweekend\b/.test(q)) {
    const sat = today.getDay() === 0 ? addDays(today, -1) : thisOrNextWeekday(6, today);
    return { start: sat < today ? today : sat, end: addDays(sat, 2), label: "this weekend" };
  }
  if (/\b(?:day|today)\b/.test(q)) return { start: today, end: addDays(today, 1), label: "today" };
  const w = weekRange(env.now, env.ctx.weekStartsOn ?? 0);
  return { ...w, label: "this week" };
}

const DAILY_PLAN_CAP = 4 * 60;
const PLAN_FROM = 9;
const PLAN_TO = 21;

/** "plan my week", "spread my homework across the weekend", "block time for all my assignments". */
function planWeekIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const plan =
    /^plan (?:out )?(?:my |the )?(?:whole )?(?:week|weekend|day|today|tomorrow|next week|rest of (?:the|my|this) week|next few days|next \d+ days)\b/.test(q) ||
    /^(?:make|build|give me|create) (?:me )?an? (?:work |homework )?(?:plan|schedule) for (?:my |the |this )?(?:week|weekend|day|today|tomorrow|next week)\b/.test(q) ||
    /^spread (?:out )?(?:my |all my |the )?(?:homework|work|assignments|studying|everything)(?: out)? (?:over|across|through(?:out)?) /.test(q) ||
    /^(?:schedule|block|find|make|set aside|plan) (?:some )?(?:time|work time|study time|blocks?) (?:for|to (?:work on|do|finish)) (?:all (?:of )?|each of |everything\b|every(?:thing)? )(?:my |the )?(?:homework|assignments?|work|things? due|tasks?|it)?/.test(q);
  if (!plan) return undefined;
  const range = planRange(env, q);
  if (+range.end <= +startOfDay(now)) return { text: `${cap(range.label)} is already over — want me to plan the days ahead instead?` };
  const cls = findClass(env, q);
  const kind = /\bhomework|assignments?\b/.test(q) ? "assignment" : /\btasks?\b/.test(q) ? "task" : undefined;
  const lookahead = Math.max(+range.end, +addDays(startOfDay(now), 3));
  const planned = new Set(ctx.items.filter((i) => i.workFor && +new Date(i.at) >= +now).map((i) => i.workFor!));
  const work = ctx.items
    .filter((i) => isOpen(i) && (!kind || i.type === kind) && (!cls || i.categoryId === cls.id))
    .filter((i) => +new Date(i.at) < lookahead && (+new Date(i.at) >= +range.start || (isOverdueAt(i, now) && +range.start <= +addDays(startOfDay(now), 1))))
    .filter((i) => !planned.has(i.id))
    .sort((a, b) => {
      const ao = isOverdueAt(a, now) ? 0 : 1;
      const bo = isOverdueAt(b, now) ? 0 : 1;
      return ao - bo || byAt(a, b);
    })
    .slice(0, 8);
  const alreadyPlanned = ctx.items.filter((i) => isOpen(i) && planned.has(i.id) && +new Date(i.at) < lookahead);
  if (!work.length) {
    return {
      text: alreadyPlanned.length
        ? `Everything due ${range.label} already has time blocked for it — you're set.`
        : `Nothing${cls ? ` for ${cls.name}` : ""} is due ${range.label === "today" ? "soon" : range.label} that needs planning — you're clear.`,
    };
  }

  const taken: Array<[Date, Date]> = [];
  const perDay = new Map<number, number>();
  const placed: Array<{ item: Item; start: Date; end: Date }> = [];
  const unplaced: Item[] = [];
  for (const item of work) {
    const minutes = estimateMinutes(item);
    const due = new Date(item.at);
    const overdue = isOverdueAt(item, now);
    const lastDay = overdue ? addDays(range.end, -1) : new Date(Math.min(+addDays(range.end, -1), +startOfDay(due)));
    let slot: [Date, Date] | null = null;
    for (let d = range.start < startOfDay(now) ? startOfDay(now) : range.start; +d <= +lastDay && !slot; d = addDays(d, 1)) {
      if ((perDay.get(+d) ?? 0) + minutes > DAILY_PLAN_CAP) continue;
      const gap = openSlots(env, d, taken, PLAN_FROM, PLAN_TO).find(([a, b]) => +b - +a >= minutes * 60_000 && (overdue || +addMinutes(a, minutes) <= +due));
      if (gap) slot = [gap[0], addMinutes(gap[0], minutes)];
    }
    if (!slot) {
      unplaced.push(item);
      continue;
    }
    // A short break after each block so the plan isn't back-to-back.
    taken.push([slot[0], addMinutes(slot[1], 15)]);
    perDay.set(+startOfDay(slot[0]), (perDay.get(+startOfDay(slot[0])) ?? 0) + minutes);
    placed.push({ item, start: slot[0], end: slot[1] });
  }
  if (!placed.length) {
    return { text: `I couldn't fit any work blocks ${range.label} — your free time runs out before the deadlines. Want me to look at a shorter block for ${bold(work[0].title)}?` };
  }
  placed.sort((a, b) => +a.start - +b.start);
  const lines = placed.map(({ item, start, end }) => {
    const dueTxt = isOverdueAt(item, now) ? "overdue" : `due ${describeWhen(env, item)}`;
    return `- **${cap(dayName(start, now))}** ${fmtTime(start, ctx.clock24h)}–${fmtTime(end, ctx.clock24h)} — ${item.title} (${dueTxt})`;
  });
  const missed = unplaced.length ? `\n\nI couldn't fit ${joinNatural(unplaced.map((i) => bold(i.title)))} before ${unplaced.length === 1 ? "its" : "their"} deadline — your calendar is full there.` : "";
  const actions: AssistantAction[] = placed.map(({ item, start, end }) => ({
    kind: "create",
    summary: `Block ${dayName(start, now)}, ${fmtTime(start, ctx.clock24h)}–${fmtTime(end, ctx.clock24h)} for “${item.title}”`,
    draft: {
      type: "event",
      title: `Work on: ${item.title}`,
      categoryId: item.categoryId,
      at: start.toISOString(),
      endAt: end.toISOString(),
      reminders: [],
      workFor: item.id,
      ...(item.url ? { url: item.url } : {}),
    },
  }));
  const already = alreadyPlanned.length ? ` (${joinNatural(alreadyPlanned.map((i) => i.title))} already ${alreadyPlanned.length === 1 ? "has" : "have"} time blocked.)` : "";
  return {
    text: `Here's a plan for ${range.label} — ${plural(placed.length, "work block")}, earliest deadlines first. None of your due dates move.${already}\n${lines.join("\n")}${missed}\n\nConfirm the blocks you want below.`,
    actions,
  };
}

/** "should I do the essay or problem set 4 first?" — deadlines decide it. */
function compareIntent(env: Env): Outcome {
  const { q, now } = env;
  const m =
    /^(?:should i|do i) (?:do|work on|start(?: with)?|finish|study for|tackle|focus on|prioriti[sz]e) (.+?) or (.+?)(?: first| next| now)?$/.exec(q) ??
    /^(?:which (?:should i do|is more urgent|comes first|first)|what (?:should i do )?first|what is more urgent)[:,]? (.+?) or (.+?)$/.exec(q) ??
    /^(.+?) or (.+?) first$/.exec(q);
  if (!m) return undefined;
  const a = resolveTarget(env, m[1], "open-work");
  const b = resolveTarget(env, m[2], "open-work");
  if (a.kind !== "one" || b.kind !== "one" || a.item.id === b.item.id) return null;
  const x = a.item;
  const y = b.item;
  const why = (i: Item) => (isOverdueAt(i, now) ? `it was due ${dayName(new Date(i.at), now)}` : `it's due ${describeWhen(env, i)}`);
  const xo = isOverdueAt(x, now);
  const yo = isOverdueAt(y, now);
  let first: Item;
  let reason: string;
  if (xo !== yo) {
    first = xo ? x : y;
    reason = `${why(first)} — it's already overdue`;
  } else if (!isSameDay(new Date(x.at), new Date(y.at))) {
    first = +new Date(x.at) < +new Date(y.at) ? x : y;
    const other = first === x ? y : x;
    reason = `${why(first)}, and ${bold(other.title)} isn't due until ${describeWhen(env, other)}`;
  } else if ((x.status === "doing") !== (y.status === "doing")) {
    first = x.status === "doing" ? x : y;
    reason = `they're both due ${dayName(new Date(x.at), now)}, and you've already started it`;
  } else {
    const [ex, ey] = [estimateMinutes(x), estimateMinutes(y)];
    first = ex >= ey ? x : y;
    reason = ex === ey ? `they're both due ${dayName(new Date(x.at), now)}; starting the first one keeps the other as your fallback` : `they're both due ${dayName(new Date(x.at), now)}, and it's likely the bigger job`;
  }
  return { text: `Start with ${bold(first.title)} — ${reason}.` };
}

/** "what should I prioritize this week" — overdue, then soonest, with in-progress work noted. */
function prioritizeIntent(env: Env): Outcome {
  const { q, now } = env;
  if (!/^(?:what should i prioriti[sz]e|what(?: is| are)? (?:my )?(?:top )?priorit(?:y|ies)|what(?: is|'s)? most (?:important|urgent|pressing)|what matters most|what should i focus on)(?: (?:this|next|for (?:the|this)) (?:week|weekend)| today| tomorrow| first| now)?$/.test(q)) return undefined;
  const range = planRange(env, q);
  const open = env.ctx.items.filter((i) => isOpen(i) && (isOverdueAt(i, now) || +new Date(i.at) < +range.end)).sort((a, b) => (isOverdueAt(a, now) ? 0 : 1) - (isOverdueAt(b, now) ? 0 : 1) || byAt(a, b));
  if (!open.length) return { text: `Nothing is due ${range.label} — you're free to get ahead on what's next.` };
  const top = open.slice(0, 3).map((i, n) => `${n + 1}. ${bold(i.title)} — ${isOverdueAt(i, now) ? `overdue (was due ${dayName(new Date(i.at), now)})` : `due ${describeWhen(env, i)}`}${i.status === "doing" ? ", already started" : ""}`);
  const more = open.length > 3 ? `\n\nAfter those, ${plural(open.length - 3, "more thing")} ${open.length - 3 === 1 ? "is" : "are"} due ${range.label}.` : "";
  return { text: `In order of what's due${range.label === "this week" ? " this week" : ` ${range.label}`}:\n${top.join("\n")}${more}` };
}

function rangeCounts(env: Env, start: Date, end: Date) {
  let classes = 0;
  let events = 0;
  let classMinutes = 0;
  let freeMinutes = 0;
  const due: Item[] = [];
  const busiest = { day: start, n: -1 };
  let lightest: { day: Date; n: number } | null = null;
  for (let d = start; +d < +end; d = addDays(d, 1)) {
    const c = collectDay(env, d, {});
    const cls = c.events.filter((e) => isClass(env, e)).length;
    classes += cls;
    events += c.events.length - cls;
    for (const e of c.events) if (!e.allDay && e.endAt) classMinutes += (+new Date(e.endAt) - +new Date(e.at)) / 60_000;
    due.push(...c.openWork);
    freeMinutes += freeGaps(env, d, WORK_START, WORK_END).filter(([a, b]) => +b - +a >= 30 * 60_000).reduce((s, [a, b]) => s + (+b - +a) / 60_000, 0);
    const n = c.events.length + c.openWork.length;
    if (n > busiest.n) Object.assign(busiest, { day: d, n });
    if (!lightest || n < lightest.n) lightest = { day: d, n };
  }
  return { classes, events, due, classMinutes, freeMinutes, busiest, lightest };
}

/** "summarize my week", "give me a rundown of tomorrow", "recap last week". */
function summaryIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/\b(?:summari[sz]e|summary|rundown|run-down|overview|recap|brief(?:ing)?|debrief|lowdown|snapshot)\b/.test(q) && !/^(?:catch me up|what(?: do i| have i) (?:have|got) going on)$/.test(q)) return undefined;
  if (/\bsyllabus\b/.test(q) || findClass(env, q)?.syllabus && /\bsyllabus|class|course\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  const today = startOfDay(now);
  if (ref && +((ref.kind === "day" ? addDays(ref.day, 1) : ref.end)) <= +today) {
    const start = ref.kind === "day" ? ref.day : ref.start;
    const end = ref.kind === "day" ? addDays(ref.day, 1) : ref.end;
    const done = ctx.items.filter((i) => isWork(i) && i.status === "done" && +new Date(i.completedAt ?? i.at) >= +start && +new Date(i.completedAt ?? i.at) < +end);
    const events = ctx.items.filter((i) => i.type === "event" && +new Date(i.at) >= +start && +new Date(i.at) < +end);
    const left = ctx.items.filter((i) => isOpen(i) && +new Date(i.at) >= +start && +new Date(i.at) < +end);
    const parts = [
      done.length ? `you finished ${bold(plural(done.length, "item"))} (${joinNatural(done.slice(0, 4).map((i) => i.title))}${done.length > 4 ? ", and more" : ""})` : "you didn't check anything off",
      events.length ? `had ${plural(events.length, "event")}` : "had nothing on the calendar",
    ];
    const tail = left.length ? ` ${plural(left.length, "thing")} from then ${left.length === 1 ? "is" : "are"} still open: ${joinNatural(left.map((i) => bold(i.title)))}.` : " Nothing from then is left open.";
    return { text: `${cap(ref.label)} ${parts.join(" and ")}.${tail}` };
  }
  if (ref?.kind === "day" || /\b(?:today|my day|the day)\b/.test(q)) {
    const day = ref?.kind === "day" ? ref : { kind: "day" as const, day: today, label: "today", text: "" };
    const base = dayAnswer(env, day, {});
    const gaps = freeGaps(env, day.day, WORK_START, WORK_END).filter(([a, b]) => +b - +a >= 60 * 60_000);
    const free = gaps.length ? `\n\nYou're free ${joinNatural(gaps.slice(0, 3).map(([a, b]) => `${fmtTime(a, ctx.clock24h)}–${fmtTime(b, ctx.clock24h)}`))}.` : "";
    return { text: `${base.text}${free}` };
  }
  const range = ref?.kind === "range" ? { start: ref.start < today ? today : ref.start, end: ref.end, label: ref.label } : { ...weekRange(now, ctx.weekStartsOn ?? 0), label: "this week" };
  const c = rangeCounts(env, range.start, range.end);
  const overdue = ctx.items.filter((i) => isOpen(i) && isOverdueAt(i, now));
  if (!c.classes && !c.events && !c.due.length) return { text: `${cap(range.label)} is clear — nothing scheduled or due.${overdue.length ? ` You do still have ${bold(`${overdue.length} overdue`)}.` : ""}` };
  const head = [c.classes ? plural(c.classes, "class", "classes") : "", c.events ? plural(c.events, "other event") : "", c.due.length ? `${c.due.length} due` : ""].filter(Boolean);
  const lines: string[] = [];
  if (c.due.length) lines.push(`- Due: ${c.due.slice(0, 6).map((i) => `${bold(i.title)} ${dayName(new Date(i.at), now)}`).join(", ")}${c.due.length > 6 ? `, +${c.due.length - 6} more` : ""}`);
  if (c.busiest.n > 0) lines.push(`- Busiest: ${bold(cap(longDay(c.busiest.day, now)))} (${plural(c.busiest.n, "thing")})`);
  if (c.lightest && c.lightest.n < c.busiest.n) lines.push(`- Lightest: ${bold(cap(longDay(c.lightest.day, now)))}${c.lightest.n === 0 ? " — wide open" : ""}`);
  if (overdue.length) lines.push(`- Overdue: ${joinNatural(overdue.slice(0, 4).map((i) => bold(i.title)))}`);
  return { text: `${cap(range.label)}: ${joinNatural(head)}.\n${lines.join("\n")}` };
}

/** "is my week realistic", "am I overloaded", "how's my workload" — a number-backed read, not a pep talk. */
function workloadIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/\b(?:realistic|manageable|doable|overloaded|over ?booked|workload|too much (?:to do|work|on my plate)|how heavy|can i (?:handle|get it all done|finish everything)|will i (?:have time|finish|get everything done))\b/.test(q)) return undefined;
  if (/\b(?:stress|overwhelm|anxious|anxiety|panic|cry|depress|burn(?:ed|t)? out|give up|hate)\w*/.test(q)) return undefined;
  const range = planRange(env, q);
  const c = rangeCounts(env, range.start < startOfDay(now) ? startOfDay(now) : range.start, range.end);
  const startsNow = +range.start <= +addDays(startOfDay(now), 1);
  const overdue = startsNow ? ctx.items.filter((i) => isOpen(i) && isOverdueAt(i, now)) : [];
  const workItems = [...overdue, ...c.due.filter((i) => !overdue.includes(i))];
  const need = workItems.reduce((s, i) => s + estimateMinutes(i), 0);
  if (!workItems.length) return { text: `${cap(range.label)} is light — nothing due, and about ${bold(hoursText(c.freeMinutes))} free outside your schedule.` };
  const ratio = need / Math.max(c.freeMinutes, 1);
  const verdict = ratio < 0.35 ? "very manageable" : ratio < 0.7 ? "full but doable" : ratio < 1 ? "tight" : "more than your free time allows";
  const crunch = c.busiest.n >= 3 ? ` ${bold(cap(longDay(c.busiest.day, now)))} is the crunch, with ${plural(c.busiest.n, "thing")} on it.` : "";
  const offer = ratio >= 0.35 ? " Want me to plan work blocks so it all fits?" : "";
  return {
    text: `${cap(range.label)} looks ${bold(verdict)}: ${plural(workItems.length, "thing")} to get done${overdue.length ? ` (${overdue.length} overdue)` : ""} — roughly ${bold(hoursText(need))} of work by my estimate — against about ${bold(hoursText(c.freeMinutes))} of free time outside your ${plural(c.classes + c.events, "scheduled thing")}.${crunch}${offer}`,
  };
}

/** "do I have any conflicts this week", "am I double-booked tomorrow". */
function conflictIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/\b(?:conflicts?|overlap(?:s|ping)?|clash(?:es)?|double[- ]?booked|double book(?:ed|ings?)?|two things at (?:the same|once))\b/.test(q)) return undefined;
  if (/\b(?:add|move|delete|fix|resolve)\b/.test(q)) return null;
  const ref = findDayRef(q, now);
  const start = ref?.kind === "day" ? ref.day : ref?.kind === "range" ? (ref.start < startOfDay(now) ? startOfDay(now) : ref.start) : startOfDay(now);
  const end = ref?.kind === "day" ? addDays(ref.day, 1) : ref?.kind === "range" ? ref.end : addDays(startOfDay(now), 7);
  const label = ref?.label ?? "in the next 7 days";
  const found: string[] = [];
  for (let d = start; +d < +end; d = addDays(d, 1)) {
    const onDay = ctx.items.filter((i) => i.type === "event" && !i.allDay && i.status !== "done" && itemOccupiesDay(i, d));
    for (const g of findOverlapGroups(onDay, d)) {
      const names = g.items.map((i) => `${bold(i.title)} (${fmtTime(i.at, ctx.clock24h)}${i.endAt ? `–${fmtTime(i.endAt, ctx.clock24h)}` : ""})`);
      found.push(`- **${cap(dayName(d, now))}** — ${joinNatural(names)}`);
    }
  }
  if (!found.length) return { text: `No conflicts ${label} — nothing overlaps.` };
  return { text: `${found.length === 1 ? "One overlap" : `${found.length} overlaps`} ${label}:\n${found.join("\n")}` };
}

/** "which class has the most work this week", "how much do I have for each class". */
function classWorkIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  if (!/\b(?:which|what) (?:class|course)(?: has| is)? (?:the )?(?:most|heaviest|biggest|least|lightest)\b|\b(?:heaviest|lightest|busiest) (?:class|course)\b|\b(?:each|every|per) (?:class|course)\b|\bby (?:class|course)\b/.test(q)) return undefined;
  const ref = findDayRef(q, now);
  const end = ref?.kind === "range" ? ref.end : ref?.kind === "day" ? addDays(ref.day, 1) : null;
  const label = ref?.label ?? "open";
  const counts = ctx.categories
    .filter((c) => !c.archived)
    .map((c) => ({ c, items: ctx.items.filter((i) => i.categoryId === c.id && isOpen(i) && (!end || +new Date(i.at) < +end)) }))
    .filter((r) => r.items.length);
  if (!counts.length) return { text: `Nothing ${label === "open" ? "open" : `due ${label}`} in any class.` };
  const least = /\b(?:least|lightest)\b/.test(q);
  counts.sort((a, b) => (least ? a.items.length - b.items.length : b.items.length - a.items.length) || a.c.name.localeCompare(b.c.name));
  if (/\b(?:each|every|per|by) (?:class|course)\b/.test(q)) {
    return { text: `${label === "open" ? "Open work" : `Due ${label}`} by class:\n${counts.map((r) => `- ${bold(r.c.name)} — ${r.items.length} (${r.items.slice(0, 3).map((i) => i.title).join(", ")}${r.items.length > 3 ? ", …" : ""})`).join("\n")}` };
  }
  const top = counts[0];
  return { text: `${bold(top.c.name)} has the ${least ? "least" : "most"}${label === "open" ? " open work" : ` due ${label}`}: ${joinNatural(top.items.slice(0, 4).map((i) => bold(i.title)))}${top.items.length > 4 ? `, plus ${top.items.length - 4} more` : ""}.` };
}

/** "what are the notes on the essay", "what's the link for problem set 4", "what reminders are on X", "tell me about the dentist". */
function detailIntent(env: Env): Outcome {
  const { q, ctx } = env;
  let m: RegExpExecArray | null;
  const field =
    (m = /^(?:what(?: is| are)? (?:the )?(?:notes?|description|details?|info(?:rmation)?) (?:on|for|of|about) |(?:show|give) me (?:the )?(?:notes?|details?) (?:on|for) |(?:tell me |what do you know )?about )(?:my |the )?(.+)$/.exec(q))
      ? "details"
      : (m = /^(?:what(?: is|'s)? (?:the )?(?:link|url|canvas link|page) (?:for|to|of) |where(?: is| can i find) (?:the )?(?:link|page) (?:for|to) |open )(?:my |the )?(.+?)(?:'s link| link)?$/.exec(q))
        ? "link"
        : (m = /^(?:what reminders?(?: do i have| are| is)? (?:set )?(?:on|for) |when (?:will|do) i (?:get reminded|get a reminder|be reminded) (?:about|for|of) |(?:do i|is there|are there) (?:have )?(?:a |any )?reminders? (?:on|for) )(?:my |the )?(.+)$/.exec(q))
          ? "reminders"
          : null;
  if (!field || !m) return undefined;
  const phrase = m[1].replace(/\b(?:assignment|event|item)$/, "").trim();
  if (!phrase || PRONOUN_ONLY.test(phrase)) return undefined;
  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return field === "details" ? undefined : null;
  if (target.kind === "many") return null;
  const i = target.item;
  if (field === "link") return i.url ? { text: `Here's the link for ${bold(i.title)}: ${i.url}` } : { text: `${bold(i.title)} doesn't have a link saved.` };
  if (field === "reminders") {
    const rs = (i.reminders ?? []).filter((r) => !r.place);
    const classNote = isClass(env, i) ? " Class heads-up reminders come from Settings → Reminders." : "";
    if (!rs.length) return { text: `${bold(i.title)} has no reminders set.${classNote}` };
    const at = new Date(i.at);
    const whens = rs.map((r) => `${r.label} (${dayName(addMinutes(at, -r.offsetMinutes), env.now)} at ${fmtTime(addMinutes(at, -r.offsetMinutes), ctx.clock24h)})`);
    return { text: `${bold(i.title)} will remind you ${joinNatural(whens)}.` };
  }
  const bits = [
    `${i.type === "event" ? "" : "due "}${describeWhen(env, i)}${i.type === "event" && i.endAt && !i.allDay ? `–${fmtTime(i.endAt, ctx.clock24h)}` : ""}`,
    className(env, i) ? `in ${className(env, i)}` : "",
    i.location ? `at ${i.location}` : "",
    i.type !== "event" ? (i.status === "done" ? "done" : i.status === "doing" ? "in progress" : "not started") : "",
  ].filter(Boolean);
  if (/\b(?:notes?|description)\b/.test(q) && !i.description?.trim()) return { text: `${bold(i.title)} doesn't have any notes — it's ${bits.join(", ")}.` };
  const notes = i.description?.trim() ? `\n\nNotes: ${i.description.trim().slice(0, 400)}${i.description.trim().length > 400 ? "…" : ""}` : "";
  const link = i.url ? `\n\nLink: ${i.url}` : "";
  const rem = i.reminders?.length ? ` Reminders: ${joinNatural(i.reminders.map((r) => r.label))}.` : "";
  return { text: `${bold(i.title)} — ${bits.join(", ")}.${rem}${notes}${link}` };
}

/** "what's in Hall B", "what do I have at the library". */
function placeIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m = /^(?:what(?: is| do i have| have i got)?|anything|what(?:'s| is) (?:happening|going on)) (?:in|at) (?:the )?(.+?)(?: (?:today|tomorrow|this week|next week))?$/.exec(q);
  if (!m) return undefined;
  const place = tokens(m[1]);
  if (!place.length || findDayRef(m[1], now) || findClass(env, m[1])) return undefined;
  const hits = ctx.items
    .filter((i) => i.location && place.every((p) => tokenMatches(p, tokens(i.location!))) && +new Date(i.endAt ?? i.at) >= +startOfDay(now))
    .sort(byAt);
  if (!hits.length) return undefined;
  const seen = new Set<string>();
  const uniq = hits.filter((i) => (seen.has(seriesKey(i)) ? false : (seen.add(seriesKey(i)), true)));
  return { text: `Coming up at ${bold(hits[0].location!)}: ${joinNatural(uniq.slice(0, 5).map((i) => `${bold(i.title)} (${describeWhen(env, i)})`))}.` };
}

/** "CS 101 meets MWF 10–10:50 in Hall B" → weekly class meetings, like the Class times sheet. */
function classTimesIntent(env: Env): Outcome {
  const { n, q, ctx, now } = env;
  if (!/\b(?:meets?|meeting times?|class (?:is|times?)|lectures? (?:is|are)|has class|is on|are on|every)\b|^(?:add|set) (?:class times|my class times|class)/.test(q)) return undefined;
  if (/\?$/.test(env.raw) || /^(?:when|what|where|who|how|does|do|is)\b/.test(q)) return undefined;
  const text = n.replace(/^(?:add|set|save|put in)\s+(?:the\s+)?(?:class times?|schedule|meeting times?)?\s*(?:for\s+)?/i, "").replace(/\b(?:meets?|has class|class is|is on|are on|lectures? (?:is|are))\b/gi, " ");
  const parsed = parseClassSchedule(text, ctx.categories, now);
  if (!parsed?.categoryId || !parsed.meetings.length) return undefined;
  const cls = ctx.categories.find((c) => c.id === parsed.categoryId)!;
  const rawLoc = parsed.location ?? /\b(?:in|at)\s+(?:the\s+)?([A-Z0-9][\w .'-]{1,40}?)(?:\s+until\b|$)/i.exec(text)?.[1]?.trim();
  const loc = rawLoc ? placeName(rawLoc).replace(/\b([a-z])\b/g, (c) => c.toUpperCase()) : undefined;
  const leftover = contentWords(parsed.title.replace(new RegExp(rawLoc ? rawLoc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "(?!)", "i"), " ").replace(/\b(?:in|at|room)\b/gi, " "));
  if (leftover.length && !leftover.every((w) => categoryTokens(cls).includes(w) || w === "class" || w === "lecture" || w === "lab")) return null;
  const existing = savedClassMeetings(ctx.items, cls.id);
  const fresh = parsed.meetings.filter((m) => !existing.some((s) => savedMeetingSlotEqual(s, m)));
  if (!fresh.length) return { text: `${bold(cls.name)} already has those class times saved.` };
  // Changing a saved time from chat would leave the old series behind and show the class twice.
  const clashing = existing.filter((s) => fresh.some((m) => m.days.some((d) => s.days.includes(d))));
  if (clashing.length) {
    return { text: `${bold(cls.name)} already meets ${joinNatural(clashing.map((s) => bold(formatMeetingSummary(s, ctx.clock24h))))}. To change that, open **Schedule → Class times** — editing it there replaces the old times instead of adding a second set.` };
  }
  const title = cls.classTitle?.trim() || cls.name;
  const lastDay = cls.syllabus?.keyDates.find((k) => /\b(?:last day of (?:classes|instruction)|classes end|end of classes|last class)\b/i.test(k.label));
  const untilIso = lastDay ? new Date(`${lastDay.date}T23:59:59`).toISOString() : parsed.until;
  const until = format(new Date(untilIso), "MMM d");
  const actions: AssistantAction[] = [];
  const labels: string[] = [];
  for (const m of fresh) {
    const range = meetingDateTimes(m, now);
    if (!range) return null;
    const summary = formatTimeRange(m.hour, m.minute, m.endHour, m.endMinute, ctx.clock24h);
    const days = m.days.map((d) => weekdayShort(d)).join("/");
    labels.push(`${days} ${summary}`);
    actions.push({
      kind: "create",
      summary: `Add ${title} — ${days} ${summary}${loc ? ` · ${loc}` : ""}, weekly until ${until}`,
      draft: {
        type: "event",
        title,
        categoryId: cls.id,
        at: range.at.toISOString(),
        endAt: range.endAt.toISOString(),
        reminders: [],
        ...(loc ? { location: loc } : {}),
        repeat: scheduleRepeat(m.days, untilIso),
      },
    });
  }
  return {
    text: `I'll add ${bold(cls.name)} class times: ${bold(joinNatural(labels))}${loc ? ` in ${loc}` : ""}, repeating weekly until ${until}.${existing.length ? " Your other saved times stay as they are." : ""} Confirm below.`,
    actions,
  };
}

/** Length, copies, all-day, type, reminders off, clearing a field. */
function moreEditsIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  let m: RegExpExecArray | null;
  const one = (phrase: string, scope: Scope, build: Build): Outcome => {
    const t = resolveTarget(env, phrase, scope);
    if (t.kind === "none") return null;
    if (t.kind === "many") return askWhich(env, t.items, build);
    return build(t.item, t.series);
  };

  // "make the meeting 2 hours long", "extend lab by 30 minutes", "shorten X by 15 min", "X should end at 5pm"
  if ((m = /^(?:make|change|set) (.+?) (?:to )?(?:be )?((?:\d+(?:\.\d+)?|an?|one|two|three|half an?)\s*(?:hours?|hrs?|minutes?|mins?))(?: long)?$/.exec(q))) {
    const mins = spanMinutes(m[2]);
    return one(m[1], "any", (item) => {
      if (item.type !== "event" || item.allDay) return null;
      const end = addMinutes(new Date(item.at), mins);
      return { text: `I'll make ${bold(item.title)} ${bold(hoursText(mins).replace(/^1 hour$/, "an hour"))}, ending at ${fmtTime(end, ctx.clock24h)}. Confirm below.`, actions: [update(item, `Make “${item.title}” ${hoursText(mins)}`, { endAt: end.toISOString() })] };
    });
  }
  if ((m = /^(extend|lengthen|shorten|cut) (.+?) by ((?:\d+|an?|one|two|half an?)\s*(?:hours?|hrs?|minutes?|mins?))$/.exec(q))) {
    const mins = spanMinutes(m[3]) * (/^(?:shorten|cut)$/.test(m[1]) ? -1 : 1);
    return one(m[2], "any", (item) => {
      if (item.type !== "event" || item.allDay) return null;
      const oldEnd = item.endAt ? new Date(item.endAt) : addMinutes(new Date(item.at), 60);
      const end = addMinutes(oldEnd, mins);
      if (+end <= +new Date(item.at)) return { text: `That would end ${bold(item.title)} before it starts.` };
      return { text: `I'll have ${bold(item.title)} end at ${bold(fmtTime(end, ctx.clock24h))} instead of ${fmtTime(oldEnd, ctx.clock24h)}. Confirm below.`, actions: [update(item, `End “${item.title}” at ${fmtTime(end, ctx.clock24h)}`, { endAt: end.toISOString() })] };
    });
  }
  if ((m = /^(?:make |have |set )?(.+?) (?:should |to )?(?:end|finish|wrap up)(?:s)? (?:at|by) (.+)$/.exec(q)) && !/^(?:when|what|does|do|is)\b/.test(q)) {
    const t = findTime(`at ${m[2]}`);
    if (!t) return undefined;
    return one(m[1].replace(/^(?:make|have|set)\s+/, ""), "any", (item) => {
      if (item.type !== "event" || item.allDay) return null;
      const end = atTime(new Date(item.at), t);
      if (+end <= +new Date(item.at)) return { text: `${bold(item.title)} starts at ${fmtTime(item.at, ctx.clock24h)}, so it can't end at ${fmtTime(end, ctx.clock24h)}.` };
      return { text: `I'll have ${bold(item.title)} end at ${bold(fmtTime(end, ctx.clock24h))}. Confirm below.`, actions: [update(item, `End “${item.title}” at ${fmtTime(end, ctx.clock24h)}`, { endAt: end.toISOString() })] };
    });
  }

  // "duplicate the review session to friday", "copy gym to tomorrow at 7am"
  if ((m = /^(?:duplicate|copy|clone|repeat) (.+?) (?:to|on|for|onto) (.+)$/.exec(q))) {
    const ref = findDayRef(m[2], now);
    const t = findTime(m[2]);
    if (!ref && !t) return undefined;
    if (ref?.kind === "range") return null;
    return one(m[1], "any", (item) => {
      const orig = new Date(item.at);
      const at = atTime(ref?.kind === "day" ? ref.day : startOfDay(orig), t ?? { h: orig.getHours(), m: orig.getMinutes() });
      const draft: Omit<Item, "id" | "createdAt"> = {
        type: item.type,
        title: item.title,
        categoryId: item.categoryId,
        at: at.toISOString(),
        ...(item.endAt ? { endAt: new Date(+at + (+new Date(item.endAt) - +orig)).toISOString() } : {}),
        ...(item.allDay ? { allDay: true } : {}),
        ...(item.location ? { location: item.location } : {}),
        ...(item.description ? { description: item.description } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.type !== "event" ? { status: "todo" as ItemStatus } : {}),
        reminders: (item.reminders ?? []).map((r) => ({ ...r, id: nanoid(), itemId: "" })),
      };
      const when = whenText(env, item, at);
      const on = /^(?:today|tomorrow)/.test(when) ? "" : "on ";
      return { text: `I'll add a copy of ${bold(item.title)} ${on}${bold(when)}. The original stays put. Confirm below.`, actions: [{ kind: "create", summary: `Copy “${item.title}” to ${when}`, draft }] };
    });
  }

  // "make the career fair all day"
  if ((m = /^(?:make|set|change) (.+?) (?:to )?(?:an? )?all[- ]day(?: event)?$/.exec(q))) {
    return one(m[1], "any", (item) => {
      if (item.allDay) return { text: `${bold(item.title)} is already all day.` };
      if (item.type !== "event") return null;
      return { text: `I'll make ${bold(item.title)} an all-day event on ${dayName(new Date(item.at), now)}. Confirm below.`, actions: [update(item, `Make “${item.title}” all day`, { allDay: true, endAt: undefined })] };
    });
  }

  // "make the reading a task", "change buy textbook to an assignment"
  if ((m = /^(?:make|change|turn|convert|mark) (.+?) (?:in)?to (?:an? )?(task|assignment|to-?do)$/.exec(q) ?? /^(?:make) (.+?) (?:an? )?(task|assignment)$/.exec(q))) {
    const type = m[2] === "assignment" ? "assignment" : "task";
    return one(m[1], "any", (item) => {
      if (item.type === "event") return null;
      if (item.type === type) return { text: `${bold(item.title)} is already ${type === "task" ? "a task" : "an assignment"}.` };
      return { text: `I'll change ${bold(item.title)} to ${type === "task" ? "a task" : "an assignment"}. Confirm below.`, actions: [update(item, `Make “${item.title}” ${type === "task" ? "a task" : "an assignment"}`, { type })] };
    });
  }

  // "remove the reminders from the essay", "turn off reminders for gym", "no reminders for X"
  if ((m = /^(?:remove|delete|clear|turn off|stop|disable|cancel|mute) (?:all |the |my )?(?:reminders?|notifications?|alerts?) (?:from|for|on|about) (.+)$/.exec(q) ?? /^(?:no|don't send|do not send) (?:reminders?|notifications?) (?:for|on|about) (.+)$/.exec(q))) {
    return one(m[1], "any", (item) =>
      item.reminders?.length
        ? { text: `I'll turn off the reminders on ${bold(item.title)} (${joinNatural(item.reminders.map((r) => r.label))}). Confirm below.`, actions: [update(item, `Remove reminders from “${item.title}”`, { reminders: [] })] }
        : { text: `${bold(item.title)} doesn't have any reminders to remove.` }
    );
  }

  // "remove the location from the dentist", "clear the notes on the essay"
  if ((m = /^(?:remove|delete|clear|erase|drop) (?:the )?(location|place|room|notes?|description|link|url) (?:from|on|for|of) (.+)$/.exec(q))) {
    const which = /^(?:location|place|room)$/.test(m[1]) ? "location" : /^(?:link|url)$/.test(m[1]) ? "url" : "description";
    const noun = which === "location" ? "location" : which === "url" ? "link" : "notes";
    return one(m[2], "any", (item) =>
      item[which]
        ? { text: `I'll remove the ${noun} from ${bold(item.title)}. Confirm below.`, actions: [update(item, `Remove the ${noun} from “${item.title}”`, { [which]: undefined })] }
        : { text: `${bold(item.title)} doesn't have ${noun === "notes" ? "any notes" : `a ${noun}`}.` }
    );
  }
  return undefined;
}

/** "never mind" / "yes, do it" right after a proposal. */
function proposalReplyIntent(env: Env): Outcome {
  const last = [...env.history].reverse().find((t) => t.role === "assistant");
  if (!last || !/Confirm(?: each| the blocks you want)? below|Confirm below to add it/.test(last.text)) return undefined;
  const q = env.q;
  if (/^(?:never ?mind|nvm|cancel(?: that| it)?|don't(?: do (?:that|it))?|do not(?: do (?:that|it))?|forget (?:it|that)|no(?: thanks| thank you)?|nope|scratch that|stop)$/.test(q)) {
    return { text: pick(q, ["No problem — nothing's changed. You can just leave that card, or tap **Cancel** to clear it.", "Okay, I won't change anything. Tap **Cancel** on the card if you want it gone."]) };
  }
  if (/^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|sounds good|perfect|great)[,!. ]*)?(?:please )?(?:do it|go ahead|confirm(?: it)?|please do|add (?:it|them)|apply (?:it|them)|make it so|let's do it|yes please)?$/.test(q) && q.trim()) {
    return { text: "Tap the button on the card above and it's done — I always wait for your tap before changing your calendar." };
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Phase 4: math, grades, emails, study plans, feeling behind          */
/* ------------------------------------------------------------------ */

/** We asked for their current grade; the reply is a number. */
let pendingGrade: { prompt: string; name: string; scale: SyllabusGradeCutoff[]; component: string; weight: number; target?: { label: string; floor: number } } | null = null;
/** We asked when something is ("What time is Dinner with Sam tomorrow?"); the reply finishes the add. */
let pendingAdd: { prompt: string; text: string } | null = null;

/** "what's 23 × 17", "15% of 80", "3.5 hours in minutes". */
function mathIntent(env: Env): Outcome {
  if (!/\d/.test(env.q)) return undefined;
  const text = answerMath(env.q);
  return text ? { text } : undefined;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
/** "an A", "an F", "an 88", "an 18" — by sound, not spelling. */
const an = (label: string) => (/^(?:[AEF]|8|11(?!\d)|18(?!\d))/i.test(label) ? "an" : "a");

/** Plain letters, best first — the syllabus scale if it has one, else 90/80/70/60. */
function scaleRows(scale: SyllabusGradeCutoff[]): Array<{ label: string; floor: number }> {
  const rows = scale
    .map((g) => ({ label: g.grade.trim().toUpperCase(), floor: Number(/(\d+(?:\.\d+)?)/.exec(g.range)?.[1]) }))
    .filter((r) => /^[A-D]$/.test(r.label) && Number.isFinite(r.floor))
    .sort((a, b) => b.floor - a.floor);
  return rows.length ? rows : ["A", "B", "C", "D"].map((l) => ({ label: l, floor: letterFloor([], l)!.floor }));
}

function neededText(g: { name: string; scale: SyllabusGradeCutoff[]; component: string; weight: number; target?: { label: string; floor: number } }, current: number): string {
  const comp = g.component.toLowerCase();
  const lead = `With ${an(fmtGrade(current))} ${bold(fmtGrade(current))} going into the ${bold(comp)} (${fmtGrade(g.weight * 100)}% of your ${g.name} grade)`;
  const need = (t: number) => neededScore(current, t, g.weight);
  const standard = !g.scale.some((s) => /^[A-D]$/i.test(s.grade.trim()));
  const scaleNote = standard ? " I used the usual 90/80/70/60 cut-offs — your syllabus doesn't list a scale." : "";
  const assume = ` That treats your ${fmtGrade(current)} as your grade on everything else.`;
  const named = (t: { label: string; floor: number }) => (/^\d/.test(t.label) ? bold(t.label) : `${an(t.label)} ${bold(t.label)} (${fmtGrade(t.floor)})`);
  if (g.target) {
    const n = need(g.target.floor);
    if (n <= 0) return `${lead}, you'll finish with at least ${named(g.target)} even with a 0 on it.${assume}`;
    if (n > 100) {
      const alt = scaleRows(g.scale).find((r) => need(r.floor) <= 100 && r.floor < g.target!.floor);
      const altText = alt ? ` ${cap(named(alt))} needs ${bold(fmtGrade(Math.max(0, round1(need(alt.floor)))))}.` : "";
      return `${lead}, you'd need ${bold(fmtGrade(round1(n)))} on it to finish with ${named(g.target)} — more than 100, so that's out of reach on the ${comp} alone.${altText}${assume}${/^\d/.test(g.target.label) ? "" : scaleNote}`;
    }
    return `${lead}, you need ${bold(fmtGrade(round1(n)))} on it to finish with ${named(g.target)}.${assume}${/^\d/.test(g.target.label) ? "" : scaleNote}`;
  }
  const rows = scaleRows(g.scale).map((r) => {
    const n = need(r.floor);
    const say = n <= 0 ? "locked in, even with a 0" : n > 100 ? `${fmtGrade(round1(n))} — out of reach` : bold(fmtGrade(round1(n)));
    return `- ${bold(r.label)} (${fmtGrade(r.floor)}): ${say}`;
  });
  return `${lead}, here's what you need on it:\n${rows.join("\n")}\n\n${assume.trim()}${scaleNote}`;
}

/** "92 on problem sets", "midterm 81", "the midterm was 81" — every number must be accounted for. */
function parseScores(text: string): Array<{ phrase: string; score: number }> | null {
  const out: Array<{ phrase: string; score: number }> = [];
  for (const chunkRaw of text.split(/,|;|\band\b|\bso\b|\bwhat\b|\bhow\b/)) {
    const chunk = chunkRaw.trim();
    if (!/\d/.test(chunk)) continue;
    const a = /(\d+(?:\.\d+)?)\s*(?:%|percent)?\s+(?:on|in|for) (?:the |my |our |all )?([a-z][a-z ]*?)(?: so far| in [a-z][a-z ]*)?$/.exec(chunk);
    const b = /^(?:i (?:got|have|had|scored|made|am at) )?(?:an? )?(?:the |my |our )?([a-z][a-z ]*?)\s*(?:[:=-]|is|was|were|are|at|average(?:d)?|avg)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent)?$/.exec(chunk);
    if (a) out.push({ phrase: a[2], score: Number(a[1]) });
    else if (b && !/^i\b/.test(b[1])) out.push({ phrase: b[1], score: Number(b[2]) });
    else return null;
  }
  return out;
}

function fmtGrade(n: number): string {
  return String(round1(n));
}

/** "what do I need on the final to get an A", "what's my grade in econ", "am I passing". */
function gradeIntent(env: Env): Outcome {
  const { q, ctx } = env;
  const needAsk = /\bwhat (?:grade |score |percent(?:age)? |mark )?do i (?:need|have to (?:get|score|make))\b|\bwhat do i need to (?:get|score|make)\b|\bhow (?:well|high|much) do i (?:need|have) to (?:do|score|get)\b/.test(q);
  const gradeAsk = /\bwhat is my (?:current |overall |class )?grade\b|\bwhat grade do i have\b|\bam i (?:passing|failing)\b|\b(?:calculate|figure out|work out) my grade\b|\bmy (?:current |overall )?grade (?:in|for|right now|so far)\b|\bwhere do i stand\b/.test(q);
  if (!needAsk && !gradeAsk) return undefined;
  const cls = findClass(env, q);
  const stripped = cls ? q.replace(cls.name.toLowerCase(), " ").replace(/\b(?:in|for) (?:my |the )?(?:class|course)\b/, " ") : q;

  if (needAsk) {
    if (/\bto pass\b/.test(q)) return null;
    const compPhrase = /\bon (?:the |my |our )?([a-z][a-z0-9 ]*?)(?= to\b| in\b| for\b| if\b| so\b|,|$)/.exec(stripped)?.[1]?.trim() || "final";
    const tgt = /\b(?:to (?:get|keep|end up with|finish with|end with|have|make|land|pull)|for)\s+(?:an?\s+)?(?:(\d+(?:\.\d+)?)\s*(?:%|percent)?|([abcd][+-]?))(?=[\s,.?!]|$)/.exec(stripped);
    const explicitW = /\b(?:worth|counts? (?:for|as)|weighted(?: at)?|is)\s+(\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(stripped)?.[1];
    const cur = /\b(?:i have|i have got|i am at|i am sitting at|currently(?: have| at| sitting at)?|my (?:current )?grade is|sitting at|i am currently at)\s+(?:an?\s+)?(\d+(?:\.\d+)?)\s*(?:%|percent)?/.exec(stripped)?.[1];

    let target: { label: string; floor: number } | undefined;
    const scale = cls?.syllabus?.gradeScale ?? [];
    if (tgt?.[1]) target = { label: tgt[1], floor: Number(tgt[1]) };
    else if (tgt?.[2]) {
      const f = letterFloor(scale, tgt[2]);
      if (!f) return null;
      target = { label: tgt[2].toUpperCase(), floor: f.floor };
    }

    let component = compPhrase;
    let weight: number | null = explicitW ? Number(explicitW) / 100 : null;
    let host = cls;
    if (weight === null) {
      // No class named: the one class whose syllabus has this component.
      const candidates = (cls ? [cls] : ctx.categories).flatMap((c) => {
        const row = c.syllabus?.grading?.length ? findComponent(c.syllabus.grading, compPhrase) : null;
        const w = row ? weightFraction(row.weight) : null;
        return row && w !== null ? [{ c, row, w }] : [];
      });
      if (candidates.length !== 1) return null;
      host = candidates[0].c;
      component = candidates[0].row.component;
      weight = candidates[0].w;
      if (tgt?.[2] && !cls) {
        const f = letterFloor(host.syllabus?.gradeScale ?? [], tgt[2]);
        if (!f) return null;
        target = { label: tgt[2].toUpperCase(), floor: f.floor };
      }
    }
    if (!(weight > 0 && weight < 1)) return null;
    const g = { name: host?.name ?? "class", scale: host?.syllabus?.gradeScale ?? [], component: cap(component), weight, target };
    if (!cur) {
      const text = `What's your grade in ${bold(host?.name ?? "the class")} right now, going into the ${bold(component.toLowerCase())}?`;
      pendingGrade = { prompt: text, ...g };
      return { text };
    }
    return { text: neededText(g, Number(cur)) };
  }

  // "What's my grade?" — Datebook has no scores, but it can do the math if they're given.
  const grading = cls?.syllabus?.grading ?? [];
  const scores = parseScores(stripped.replace(/\bwhat is my .*$|\bam i (?:passing|failing).*$/, ""));
  if (scores === null) return null;
  if (scores.length) {
    if (!cls || !grading.length) return null;
    const res = weightedSoFar(grading, scores);
    if (!res) return null;
    const letter = cls.syllabus?.gradeScale.length ? letterFor(cls.syllabus.gradeScale, res.average) : null;
    const parts = joinNatural(res.used.map((u) => u.component.toLowerCase()));
    const rest = grading.filter((row) => !res.used.some((u) => u.component === row.component));
    const final = rest.find((row) => /\bfinal\b/i.test(row.component) && weightFraction(row.weight) !== null);
    const covered = res.covered < 0.999 ? ` (that covers ${parts} — ${fmtGrade(res.covered * 100)}% of the grade)` : "";
    return {
      text: `Based on those, you're at ${bold(fmtGrade(res.average))} in ${bold(cls.name)}${covered}.${letter ? ` That's ${an(letter)} ${bold(letter)} on the syllabus scale.` : ""}${final ? ` Ask me what you need on the ${final.component.toLowerCase()} to get a grade you want and I'll work it out.` : ""}`,
    };
  }
  const intro = `Datebook doesn't keep your scores, so I can't see your grade${cls ? ` in ${bold(cls.name)}` : ""}`;
  if (cls && grading.length) {
    const example = grading.slice(0, 2).map((row, i) => `${row.component.toLowerCase()} ${i ? 81 : 92}`).join(", ");
    return {
      text: `${intro} — but I can work it out if you tell me what you have. ${cls.name} is graded:\n${grading.map((row) => `- ${bold(row.component)} — ${row.weight}`).join("\n")}\n\nSend something like "${example}" and I'll do the math.`,
    };
  }
  return { text: `${intro}. If you tell me your scores and how much each part is worth, I'll work out where you stand.` };
}

/** The class an email is about: named directly, via its instructor's name, or via the item. */
function classForEmail(env: Env, body: string): Category | undefined {
  const named = findClass(env, body);
  if (named) return named;
  const byPerson = env.ctx.categories.filter((c) =>
    (c.syllabus?.people ?? []).some((p) => {
      const last = p.name.trim().split(/\s+/).pop()?.toLowerCase();
      return last && last.length > 2 && new RegExp(`\\b${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(body);
    })
  );
  return byPerson.length === 1 ? byPerson[0] : undefined;
}

/** "email my econ professor asking for an extension on problem set 4 because I was sick". */
function emailIntent(env: Env): Outcome {
  const { q, n, ctx, now } = env;
  if (!/\b(?:e-?mail|message|msg|note)\b/.test(q)) return undefined;
  if (!/\b(?:professor|prof|instructor|teacher|lecturer|ta|t\.a\.|teaching assistant|dr\.? [a-z]+)\b/.test(q)) return undefined;
  // Writing one, not asking for an address ("what's the professor's email").
  if (!/^(?:write|draft|compose|send|e-?mail|message|shoot|type up|make|create|put together|help me (?:write|draft)|how (?:do|should) i (?:email|ask))\b/.test(q)) return undefined;
  if (/\b(?:give up|hopeless|depress\w*|suicid\w*|hurt myself|kill myself|self[- ]harm)\b/.test(q)) return null;
  const kind: EmailKind | null = /\b(?:extension|more time|extra time|extend (?:the |my )?(?:deadline|due date)|(?:turn|hand|submit)(?:ting)? (?:it |.+ )?in late|submit (?:it )?late|late submission)\b/.test(q)
    ? "extension"
    : /\b(?:miss(?:ing)?|won't be (?:in|at)|will not be (?:in|at|able to (?:come|attend|make it))|can't (?:make it|come|attend|go)|cannot (?:make it|come|attend|go)|absent|absence|skip(?:ping)?|not (?:be )?(?:coming|attending|in class))\b/.test(q)
      ? "absence"
      : /\b(?:meet(?:ing)?|office hours|set up a time|(?:talk|chat) (?:to|with)|appointment|go over)\b/.test(q)
        ? "meeting"
        : null;
  // Any other email ("about the reading") is open-ended writing.
  if (!kind) return null;

  const reasonM = /\b(?:because|since|cause|cuz|bc|due to)\s+(.+)$/i.exec(n);
  let reason = reasonM?.[1]?.trim();
  if (reason && /^due to/i.test(reasonM![0])) reason = `of ${reason}`;
  if (reason && (reason.length > 100 || /[?]/.test(reason) || /\b(?:you|your)\b/i.test(reason))) return null;
  const body = reasonM ? q.slice(0, q.length - reasonM[0].length).trim() : q;
  const wantTa = /\b(?:ta|t\.a\.|teaching assistant)\b/.test(body);

  let cls = classForEmail(env, body);
  let item: Item | undefined;
  let extra: string | undefined;
  let dayText: string | undefined;
  let subjectDay: string | undefined;
  if (kind === "extension") {
    extra = /\b(?:(?:a|an|one|two|three|four|five|\d+|a couple(?: of)?|a few) (?:more )?(?:days?|weeks?)|until (?:next )?[a-z]+day)\b/.exec(body)?.[0];
    let phrase = /\b(?:extension|more time|extra time|extend(?: the| my)? (?:deadline|due date))\s+(?:on|for)\s+(?:the |my )?(.+?)$/.exec(body)?.[1] ?? /\b(?:turn|hand|submit)(?:ting)? (?:in )?(?:the |my )?(.+?) (?:in )?late\b/.exec(body)?.[1];
    if (phrase) {
      phrase = phrase.replace(extra ?? "(?!)", " ").replace(/\b(?:by|of|for)\s*$/, "").replace(/\b(?:in|for) (?:my |the )?(?:class|course)\b/, " ").trim();
      if (cls) phrase = phrase.replace(cls.name.toLowerCase(), " ").trim();
      if (phrase) {
        const t = resolveTarget(env, phrase, "open-work");
        if (t.kind !== "one") return null;
        item = t.item;
      }
    }
    if (!item && cls) {
      const soon = ctx.items.filter((i) => i.categoryId === cls!.id && isOpen(i) && +new Date(i.at) >= +now && +new Date(i.at) < +addDays(now, 14)).sort(byAt);
      if (soon.length !== 1) return null;
      item = soon[0];
    }
    if (!item) return null;
    const itemCls = categoryOf(env, item);
    if (cls && itemCls && itemCls.id !== cls.id) return null;
    cls = itemCls ?? cls;
  } else {
    if (!cls) return null;
    const ref = findDayRef(body, now);
    if (ref?.kind === "range") return null;
    if (ref?.kind === "day") {
      subjectDay = format(ref.day, "EEEE, MMM d");
      dayText = /^(?:today|tomorrow|tonight)$/.test(ref.label) ? `${ref.label === "tonight" ? "tonight" : ref.label} (${subjectDay})` : `on ${subjectDay}`;
    } else if (kind === "absence") return null;
    if (kind === "meeting") {
      extra = /\b(?:about|to (?:talk about|discuss|go over|review|ask about))\s+(.+?)$/.exec(body)?.[1]?.replace(/\b(?:today|tomorrow|this week|next week|on [a-z]+day)\b/g, "").trim();
      if (extra && (extra.length > 60 || /\b(?:professor|prof|instructor|ta)\b/.test(extra))) return null;
      // "about meeting in office hours" is the request itself, not a topic.
      if (extra && /\b(?:meet(?:ing)?|office hours|appointment|a time)\b/.test(extra)) extra = undefined;
      if (extra && cls) extra = extra.replace(new RegExp(`\\b(?:in |for )?${cls.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`), "").trim() || undefined;
    }
  }
  if (!cls) return null;
  const info = cls.syllabus;
  const person = recipient(info, wantTa);
  if (wantTa && !person) return null;
  const policy =
    kind === "extension"
      ? info?.policies.find((p) => /\blate|extension|deadline/i.test(p.topic))
      : kind === "absence"
        ? info?.policies.find((p) => /attend|absen/i.test(p.topic))
        : undefined;
  const dueText = item ? `${format(new Date(item.at), "EEEE, MMM d")}${describeWhen(env, item).includes(" at ") ? ` at ${fmtTime(new Date(item.at), ctx.clock24h)}` : ""}` : undefined;
  return {
    text: draftEmail({
      kind,
      className: cls.name,
      courseLabel: info?.courseCode?.trim() || cls.name,
      person,
      itemTitle: item?.title,
      dueText,
      dayText,
      subjectDay,
      extra,
      reason,
      policy,
    }),
  };
}

const EXAM_WORD = /\b(?:exam|midterm|final|quiz|test)\b/i;
const STUDY_FOCUS: Record<number, string[]> = {
  1: ["Review notes and work practice problems"],
  2: ["Go through notes and key concepts", "Practice problems and weak spots"],
  3: ["Go through notes and key concepts", "Work practice problems", "Practice exam and weak spots"],
  4: ["Go through notes and key concepts", "Work practice problems", "Rework what you missed", "Practice exam and final review"],
};

/** "make me a study plan for the midterm", "help me study for econ". */
function studyPlanIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const m = /^(?:make (?:me )?|create (?:me )?|build (?:me )?|give me |write (?:me )?|draft (?:me )?|put together )?(?:an? )?(?:study (?:plan|schedule)|plan (?:out )?(?:my )?(?:studying|study sessions)|plan to study)\s+for\s+(?:the |my |our )?(.+)$/.exec(q) ??
    /^(?:help me |how should i )?(?:study|prepare|prep|get ready)\s+for\s+(?:the |my |our )?(.+)$/.exec(q);
  if (!m) return undefined;
  // "study for econ tomorrow" is one block on one day — the planner's job.
  if (findDayRef(m[1], now)) return undefined;
  const phrase = m[1].replace(/\b(?:this|next) (?:week|weekend)\b/, "").trim();
  const cls = findClass(env, phrase);
  let exam: Item | undefined;
  const upcomingExams = (c?: Category) =>
    ctx.items.filter((i) => i.type === "event" && EXAM_WORD.test(i.title) && +new Date(i.at) > +now && (!c || i.categoryId === c.id)).sort(byAt);
  const rest = cls ? phrase.replace(cls.name.toLowerCase(), " ").replace(/\b(?:class|course|exam|test)\b/g, " ").trim() : phrase;
  if (cls && !rest) {
    const list = upcomingExams(cls);
    if (!list.length) return { text: `I don't see an upcoming exam for ${bold(cls.name)} on your calendar. Add it (like "econ final Dec 10 at 9am") and I'll plan study time before it.` };
    exam = list[0];
  } else {
    const t = resolveTarget(env, phrase, "any");
    if (t.kind === "many") {
      const future = t.items.filter((i) => +new Date(i.at) > +now);
      if (future.length !== 1) return null;
      exam = future[0];
    } else if (t.kind === "one") exam = t.item;
    else return null;
  }
  if (!exam || +new Date(exam.at) <= +now) return null;
  // A study plan for an assignment is a work plan — that's the planner's job.
  if (exam.type !== "event") return undefined;

  const examDay = startOfDay(new Date(exam.at));
  const days = differenceInCalendarDays(examDay, startOfDay(now));
  if (days < 1) return { text: `${bold(exam.title)} is today at ${fmtTime(new Date(exam.at), ctx.clock24h)} — too soon for a plan. Use the time you have for a quick pass over your notes and a few practice problems.` };
  const already = ctx.items.filter((i) => i.type === "event" && i.title === `Study for: ${exam!.title}` && +new Date(i.at) >= +now);
  const want = Math.min(4, days) - already.length;
  if (want <= 0) {
    return { text: `You already have ${plural(already.length, "study session")} blocked for ${bold(exam.title)}: ${joinNatural(already.map((i) => bold(`${dayName(new Date(i.at), now)} ${fmtTime(new Date(i.at), ctx.clock24h)}`)))}. Want me to add another?` };
  }
  const minutes = /\b(?:final|midterm)\b/i.test(exam.title) ? 90 : /\bquiz\b/i.test(exam.title) ? 45 : 60;
  const span = Math.min(days, 8);
  const taken: Array<[Date, Date]> = already.map((i) => [new Date(i.at), new Date(i.endAt ?? i.at)]);
  const placed: Array<[Date, Date]> = [];
  for (let k = 0; k < want; k += 1) {
    // Evenly spaced, the last one the day before.
    const ideal = addDays(examDay, -(1 + Math.round(((want - 1 - k) * (span - 1)) / Math.max(1, want - 1))));
    const order = [0, 1, -1, 2, -2, 3, -3].map((d) => addDays(ideal, d)).filter((d) => +d >= +startOfDay(now) && +d < +examDay);
    for (const d of order) {
      if (placed.some(([s]) => isSameDay(s, d))) continue;
      const gap = openSlots(env, d, taken, PLAN_FROM, PLAN_TO).find(([a, b]) => +b - +a >= minutes * 60_000 && +a >= +now);
      if (gap) {
        const slot: [Date, Date] = [gap[0], addMinutes(gap[0], minutes)];
        placed.push(slot);
        taken.push([slot[0], addMinutes(slot[1], 15)]);
        break;
      }
    }
  }
  if (!placed.length) return { text: `I couldn't find a free ${hoursText(minutes)} before ${bold(exam.title)} — your calendar is full until then. Want me to look for shorter sessions?` };
  placed.sort((a, b) => +a[0] - +b[0]);
  const focus = STUDY_FOCUS[placed.length + already.length].slice(already.length);
  const lines = placed.map(([s, e], i) => `- **${cap(dayName(s, now))}** ${fmtTime(s, ctx.clock24h)}–${fmtTime(e, ctx.clock24h)} — ${focus[i] ?? "Review"}`);
  const actions: AssistantAction[] = placed.map(([s, e], i) => ({
    kind: "create",
    summary: `Block ${dayName(s, now)}, ${fmtTime(s, ctx.clock24h)}–${fmtTime(e, ctx.clock24h)} to study for “${exam!.title}”`,
    draft: {
      type: "event",
      title: `Study for: ${exam!.title}`,
      categoryId: exam!.categoryId,
      at: s.toISOString(),
      endAt: e.toISOString(),
      reminders: [],
      ...(focus[i] ? { description: focus[i] } : {}),
    },
  }));
  const short = placed.length < want ? ` I could only fit ${plural(placed.length, "session")} — the rest of your time before it is booked.` : "";
  return {
    text: `Here's a study plan for ${bold(exam.title)} (${describeWhen(env, exam)}) — ${plural(placed.length, "session")} of ${hoursText(minutes)}, building up to the day before.${already.length ? ` That's on top of the ${plural(already.length, "session")} you already have.` : ""}${short}\n${lines.join("\n")}\n\nConfirm the sessions you want below.`,
    actions,
  };
}

/** Distress that isn't about the calendar — the model handles these with care. */
const CRISIS = /\b(?:give up|giving up|can't cope|cannot cope|can't do this anymore|cannot do this anymore|hopeless|depress\w*|suicid\w*|kill myself|hurt myself|self[- ]harm|panic attacks?|want to die|end it all|crying|breakdown|anxiety|anxious|burn(?:ed|t) out|exhausted|lonely|hate myself|worthless)\b/;

/** "I'm so behind", "I'm overwhelmed with homework, what do I drop?" — triage from the calendar. */
function behindIntent(env: Env): Outcome {
  const { q, now, ctx } = env;
  const feeling = /\b(?:overwhelm(?:ed|ing)?|stress(?:ed|ing)?(?: out)?|swamped|drowning|buried|so behind|really behind|falling behind|way behind|behind on (?:everything|my work|homework|school|assignments)|too much (?:to do|work|homework|due|going on|on my plate)|so much (?:to do|work|homework|due))\b/.test(q);
  if (!feeling) return undefined;
  if (CRISIS.test(q)) return null;
  // Triage only when they ask where to start or say they're behind; a feeling
  // on its own ("I'm so stressed about this week") deserves the model's reply.
  const asksDirection = /\b(?:what (?:do|should|can) i (?:drop|skip|do first|start with|focus on|work on first|tackle first|cut|let go of|push|put off)|where (?:do|should) i (?:start|begin)|what (?:comes|goes|should i do) first|what can wait|how do i catch up|help me (?:get|catch) (?:back )?(?:on track|up))\b/.test(q);
  const behind = /\b(?:so behind|really behind|falling behind|way behind|behind on (?:everything|my work|homework|school|assignments))\b/.test(q);
  if (!asksDirection && !behind) return null;
  // Anything longer than a sentence or two is a conversation, not a triage request.
  if (q.split(" ").length > 22) return null;

  const open = ctx.items.filter(isOpen);
  const overdue = open.filter((i) => isOverdueAt(i, now)).sort(byAt);
  const soon = open.filter((i) => !isOverdueAt(i, now) && +new Date(i.at) < +addDays(startOfDay(now), 3)).sort(byAt);
  const later = open.filter((i) => +new Date(i.at) >= +addDays(startOfDay(now), 3) && +new Date(i.at) < +addDays(startOfDay(now), 10)).sort(byAt);
  const seed = `${q}|${now.getHours()}`;
  if (!overdue.length && !soon.length) {
    return {
      text: `${pick(seed, ["That feeling is real, but your calendar is kinder than it feels:", "Here's the good news:"])} nothing is overdue and nothing is due in the next couple of days.${later.length ? ` The next deadline is ${bold(later[0].title)} (${describeWhen(env, later[0])}).` : ""} Want me to spread your work across the week so it's not all at the end? Just say **plan my week**.`,
    };
  }
  const line = (i: Item) => `- ${bold(i.title)} — ${isOverdueAt(i, now) ? `overdue (was due ${dayName(new Date(i.at), now)})` : `due ${describeWhen(env, i)}`}${i.status === "doing" ? ", already started" : ""}`;
  const first = [...overdue, ...soon].slice(0, 4);
  const lead = pick(seed, ["That's a lot at once — let's make it smaller.", "Okay, let's take it one thing at a time.", "Let's cut this down to what actually matters right now."]);
  const firstText = `\n\n**Focus on these first:**\n${first.map(line).join("\n")}`;
  const rest = overdue.length + soon.length - first.length;
  const more = rest > 0 ? `\n\n${plural(rest, "other thing")} ${rest === 1 ? "is" : "are"} also due in the next few days, but start with the list above.` : "";
  const waitItems = later.slice(0, 3);
  const canWait = waitItems.length ? `\n\n**These can wait:** ${joinNatural(waitItems.map((i) => `${bold(i.title)} (${describeWhen(env, i)})`))}.` : "";
  const task = open.find((i) => i.type === "task");
  const drop = /\b(?:drop|skip|let go|push off|put off)\b/.test(q) && task
    ? ` Tasks are the easiest to move — say something like **push ${task.title.toLowerCase()} to next week**.`
    : "";
  return {
    text: `${lead}${firstText}${more}${canWait}\n\nWant me to block time for these? Say **plan my week** and I'll fit work sessions around your classes.${drop}`,
  };
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
const REASONING_OK = new RegExp(
  [
    String.raw`^(?:what|which) (?:should|do) i (?:work on|do|tackle|start with|focus on|prioriti[sz]e)`,
    String.raw`^when (?:should|can|could) i (?:work on|study for|study|do|start|finish|get to)\b`,
    String.raw`\bshould i (?:bring|buy)\b`,
    // Plans, comparisons, summaries and workload reads have exact answers from the calendar.
    String.raw`^plan (?:out )?(?:my |the )?(?:whole )?(?:week|weekend|day|today|tomorrow|next week|rest of (?:the|my|this) week|next few days)$`,
    String.raw`^(?:should i|do i) (?:do|work on|start(?: with)?|finish|study for|tackle|focus on|prioriti[sz]e) .+ or .+`,
    String.raw`^summari[sz]e (?:my |the )?(?:week|day|today|tomorrow|next week|weekend|yesterday|last week|week ahead)$`,
    String.raw`^(?:is|are|how|what|am|can|will|do)\b.*\b(?:realistic|manageable|doable|overloaded|workload|too much)\b`,
  ].join("|")
);

const ACTION_VERB = "(?:mark|move|delete|add|remove|complete|reschedule|push|cancel|rename|finish|start|remind|set|change|schedule|block|find|create|book|put|reopen|postpone|check off)";
const COMPOUND_SPLIT = new RegExp(String.raw`\s*;\s*|,?\s+(?:and then|then|and also|also)\s+|,?\s+and\s+(?=${ACTION_VERB}\b)|,\s+(?=${ACTION_VERB}\b)`);
const FOLLOW_UP = /^(?:and\s+|what about\s+|how about\s+|what of\s+|and what about\s+|then\s+)(.+)$/;

function questionNeedsContext(q: string): boolean {
  return /\b(?:same|instead|the other|another one|before that|after that|earlier one|later one|previous)\b/.test(q);
}

function run(env: Env): Outcome {
  const pipeline: Array<(e: Env) => Outcome> = [
    proposalReplyIntent,
    smallTalk,
    (e) => answerHelpQuestion(e.q),
    syllabusIntent,
    classTimesIntent,
    planWeekIntent,
    compareIntent,
    prioritizeIntent,
    plannerIntent,
    reminderIntent,
    moreEditsIntent,
    fieldEditIntent,
    moveIntent,
    deleteIntent,
    renameIntent,
    completeIntent,
    addIntent,
    focusIntent,
    summaryIntent,
    workloadIntent,
    conflictIntent,
    classWorkIntent,
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
    detailIntent,
    placeIntent,
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
  const importedFromSyllabus = new Set(env.ctx.items.filter((i) => isSyllabusSourceUid(i.sourceUid)).map((i) => i.categoryId));
  const res = answerSyllabusQuestion({
    q: env.q,
    raw: env.raw.toLowerCase(),
    now: env.now,
    categories: env.ctx.categories,
    named: findClass(env, env.q),
    importedFromSyllabus,
  });
  if (!res) return res;
  const { missing, ...out } = res;
  // "When are office hours?" with an Office Hours event on the calendar: the
  // calendar answers that better than a note about missing syllabus details.
  if (missing && calendarMentions(env)) return undefined;
  const cls = /(?:What do you want to know|Which one do you want)\?$/.test(out.text) ? /\*\*(.+?)\*\*/.exec(out.text)?.[1] : undefined;
  if (cls) pendingSyllabus = { prompt: out.text, className: cls };
  return out;
}

const QUESTION_WORDS = new Set(["who", "what", "when", "where", "which", "how", "is", "are", "can", "do", "does", "tell", "about", "syllabus", "say", "says", "much", "many", "wa", "will", "should", "could", "would"]);

/** Does the question name something that's actually on the calendar? */
function calendarMentions(env: Env): boolean {
  const cls = findClass(env, env.q);
  const want = tokens(env.q).filter((t) => !QUESTION_WORDS.has(t) && !categoryTokens(cls).includes(t));
  if (!want.length) return false;
  return env.ctx.items.some((i) => {
    if (cls && i.categoryId !== cls.id) return false;
    const have = tokens(i.title);
    return want.filter((w) => tokenMatches(w, have)).length >= Math.min(2, want.length);
  });
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
  // "this"/"that" are pronouns only on their own — "this week", "that friday" are dates.
  const single = /\b(?:it|that one|this one)\b(?!\s+(?:is due|was due))|\b(?:that|this)\b(?=\s+(?:to|on|for|by|as|until|till|back|up|done|off|first|now|over|forward|later|earlier)\b|\s*$)/;
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

  // "88" after we asked for their current grade.
  if (depth === 0 && pendingGrade) {
    const g = pendingGrade;
    pendingGrade = null;
    if (lastAssistant?.text === g.prompt) {
      const r = expand(normalize(raw) || raw);
      const num = /^(?:(?:i have|i am at|it is|about|around|like|roughly|currently|an?)\s+)*(\d+(?:\.\d+)?)\s*(?:%|percent)?$/.exec(r)?.[1];
      if (num && Number(num) <= 110) return { text: neededText(g, Number(num)) };
    }
  }

  // "7pm" after we asked what time something is.
  if (depth === 0 && pendingAdd) {
    const p = pendingAdd;
    pendingAdd = null;
    if (lastAssistant?.text === p.prompt) {
      const r = expand(normalize(raw) || raw);
      if (/^(?:never ?mind|nvm|cancel|forget (?:it|about it)|no|nope|don't|do not|skip it)\b/.test(r)) return { text: "No problem — I won't add it." };
      const when = r.replace(/^(?:it is|it's|its|how about|make it|let's say|say|um|uh)\s+/, "").replace(/^(\d{1,2}(?::\d{2})?)$/, "at $1");
      if (when.split(" ").length <= 7 && (findDayRef(when, now) || findTime(when) || /\ball[- ]day\b/.test(when))) {
        return tryLocalAnswer(`${p.text} ${when}`, [], ctx, now, 1);
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

  // Asks with one right answer that the reasoning gate below would send away:
  // math, grade math, emails from a template, study plans, and "I'm so behind".
  if (depth === 0) {
    const early: Env = { ctx, now, raw, n, q, history };
    for (const step of [mathIntent, gradeIntent, emailIntent, studyPlanIntent, behindIntent]) {
      const out = step(early);
      if (out !== undefined) return out;
    }
  }

  const emotional = /\b(?:stress|overwhelm|anxious|anxiety|panic|worried|burn(?:ed|t)? out|give up|can't cope)\w*/.test(q);
  if (NEEDS_REASONING.test(q) && (emotional || !REASONING_OK.test(q))) return null;
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
