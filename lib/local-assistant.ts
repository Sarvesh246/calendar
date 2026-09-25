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
import type { Category, Item, ItemStatus } from "./types";

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
    if (mod === "next") d = addDays(nextOccurrence(dow, today), 7);
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

function nextOccurrence(dow: number, from: Date): Date {
  let d = addDays(startOfDay(from), 1);
  while (d.getDay() !== dow) d = addDays(d, 1);
  return d;
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

/** Ask which of a few matches was meant; more than a handful is the model's job. */
function askWhich(env: Env, items: Item[]): AssistantResponse | null {
  if (items.length > 4) return null;
  const options = items.map((i) => `${bold(i.title)} (${describeWhen(env, i)})`);
  const last = options.pop();
  return { text: `Which one do you mean — ${options.length ? `${options.join(", ")} or ${last}` : last}?` };
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

function setStatus(env: Env, phrase: string, status: ItemStatus): Outcome {
  const p = phrase.trim();
  if (!p || PRONOUN_ONLY.test(p)) return null;
  if (/\b(?:everything|all|every|each)\b/.test(p) && !/\ball[- ]day\b/.test(p)) return null;
  const scope: Scope = status === "done" ? "open-work" : status === "todo" ? "done-work" : "open-work";
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
  if (target.kind === "many") return askWhich(env, target.items);
  const { item } = target;
  if (item.type === "event") return null;
  const current = item.status ?? "todo";
  if (current === status) {
    return { text: `${bold(item.title)} is already ${status === "doing" ? "in progress" : status === "done" ? "done" : "on your to-do list"}.` };
  }
  const verb = status === "done" ? "as done" : status === "doing" ? "as in progress" : "to to-do";
  const text =
    status === "done"
      ? pick(item.title, [`I'll mark ${bold(item.title)} as done — confirm below.`, `Marking ${bold(item.title)} done. Confirm below and it's checked off.`])
      : status === "doing"
        ? `I'll mark ${bold(item.title)} as in progress — confirm below.`
        : `I'll reopen ${bold(item.title)} — confirm below.`;
  return { text, actions: [update(item, `Mark “${item.title}” ${verb.replace("as ", "")}`.replace("to to-do", "to do"), { status })] };
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
  if ((m = /^(?:mark|set|check off|tick off|cross off|complete)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished|off))?$/.exec(q)) && !/\b(?:overdue|late)\b/.test(q)) {
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
  const verb = MOVE_VERB.exec(q);
  if (!verb) return undefined;
  const body = verb[2];
  if (/\b(?:everything|all my|all of|all events|all tasks)\b/.test(body)) return null;

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

  for (const attempt of attempts) {
    const target = resolveTarget(env, attempt.targetText, "any");
    if (target.kind === "none") continue;
    if (target.kind === "many") return askWhich(env, target.items);
    const { item, series } = target;
    const result = attempt.apply(item);
    if (!result) return null;
    const from = new Date(item.at);
    const to = result.at;
    if (+to === +from) return { text: `${bold(item.title)} is already at that time — ${describeWhen(env, item)}.` };
    if (item.type !== "event" && item.status === "done") return null;
    const patch: Partial<Item> = { at: to.toISOString() };
    if (item.endAt) patch.endAt = new Date(+new Date(item.endAt) + (+to - +from)).toISOString();
    const eod = (d: Date) => item.type !== "event" && d.getHours() === 23 && d.getMinutes() === 59;
    const toText = `${dayName(to, now)}${item.allDay || eod(to) ? "" : ` at ${fmtTime(to, env.ctx.clock24h)}`}`;
    const once = series > 1 ? " (just this one)" : "";
    const lead = item.type === "event" ? `Moving ${bold(item.title)}` : `Moving the ${bold(item.title)} deadline`;
    return {
      text: `${lead} from ${describeWhen(env, item)} to ${bold(toText)}${once}. Confirm below.`,
      actions: [update(item, `Move “${item.title}” to ${toText}`, patch)],
    };
  }
  return null;
}

function deleteIntent(env: Env): Outcome {
  const m = /^(?:delete|remove|cancel|trash|get rid of|drop|scrap|erase)\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const phrase = m[1];
  if (/\b(?:everything|all|every|whole|entire)\b/.test(phrase) && !/\ball[- ]day\b/.test(phrase)) return null;
  if (/\b(?:my )?(?:calendar|schedule|account|data|reminders?)\b/.test(phrase) && !/\bclass\b/.test(phrase)) return null;
  if (PRONOUN_ONLY.test(phrase.trim())) return null;
  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items);
  const { item, series } = target;
  const once = series > 1 ? " — just this one, not the whole series" : "";
  return {
    text: `I'll delete ${bold(item.title)} (${describeWhen(env, item)})${once}. Confirm below.`,
    actions: [{ kind: "delete", summary: `Delete “${item.title}”`, itemId: item.id, itemTitle: item.title }],
  };
}

function renameIntent(env: Env): Outcome {
  const m = /^(?:rename|retitle|re-title)\s+(.+?)\s+(?:to|as)\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const target = resolveTarget(env, m[1], "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items);
  const original = /^(?:rename|retitle|re-title)\s+.+?\s+(?:to|as)\s+(.+)$/i.exec(env.n);
  const title = (original?.[1] ?? m[2]).trim().replace(/^["']|["']$/g, "");
  if (!title || title.length > 120) return null;
  if (title === target.item.title) return { text: `${bold(title)} already has that name.` };
  return {
    text: `I'll rename ${bold(target.item.title)} to ${bold(title)}. Confirm below.`,
    actions: [update(target.item, `Rename to “${title}”`, { title })],
  };
}

function reminderIntent(env: Env): Outcome {
  const m = /^(?:remind me (?:about|of)|add (?:a )?reminder (?:to|for|on)|set (?:a )?reminder (?:for|on|to)|add (?:a )?reminder)\s+(.+?)\s+((?:a|an|one|two|three|four|five|six|couple(?: of)?|\d+)\s+(?:minute|min|hour|hr|day|week)s?)\s+(?:before|early|ahead)$/.exec(env.q)
    ?? /^(?:remind me)\s+((?:a|an|one|two|three|four|five|six|couple(?: of)?|\d+)\s+(?:minute|min|hour|hr|day|week)s?)\s+before\s+(.+)$/.exec(env.q);
  if (!m) return undefined;
  const swapped = /^remind me\s+(?:a|an|one|two|three|four|five|six|couple|\d+)\b/.test(env.q);
  const phrase = swapped ? m[2] : m[1];
  const minutes = parseDelta(swapped ? m[1] : m[2]);
  if (!minutes || minutes > 14 * 1440) return null;
  const target = resolveTarget(env, phrase, "any");
  if (target.kind === "none") return null;
  if (target.kind === "many") return askWhich(env, target.items);
  const { item } = target;
  const label = formatOffsetLabel(minutes);
  if (item.reminders?.some((r) => r.offsetMinutes === minutes && !r.place)) {
    return { text: `${bold(item.title)} already has a reminder ${label}.` };
  }
  const reminders = [...(item.reminders ?? []), { id: nanoid(), itemId: item.id, offsetMinutes: minutes, label }];
  return {
    text: `I'll add a reminder ${label} ${bold(item.title)}. Confirm below.`,
    actions: [update(item, `Remind ${label} “${item.title}”`, { reminders })],
  };
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
  const rich = /\b(?:remind(?:er|ers| me)|ping me|nudge me|don'?t forget)\b/i.test(stripped) && !isTask;
  if (parsed.repeat || rich || reminderCount > 1) return null;
  // No date means the model should ask, not us guessing "today".
  if (!parsed.confidence.date) return null;
  const timed = HAS_TIME.test(stripped);
  if (parsed.type === "event" && !isTask && !parsed.allDay && !timed) return null;
  const title = parsed.title.replace(/^(?:a|an|the)\s+/i, "").trim();
  if (!titleIsFaithful(stripped, parsed.title, parsed.location, ctx.categories.find((c) => c.id === parsed.categoryId))) return null;
  if (!title || title.length > 90 || title.split(/\s+/).length > 12) return null;
  if (/^(?:a |the )?(?:reminder|event|task|assignment|meeting)$/i.test(title)) return null;

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
    ...(parsed.location ? { location: parsed.location } : {}),
    ...(reminders?.length ? { reminders } : {}),
  };
  if (type !== "event") draft.status = "todo";
  const endOfDay = type !== "event" && !timed;
  const day = dayName(due, now);
  const relDay = /^(?:today|tomorrow|yesterday)$/.test(day);
  const whenText = parsed.allDay ? `${day} (all day)` : endOfDay ? day : `${day} at ${fmtTime(due, ctx.clock24h)}`;
  const extras = [
    parsed.location ? `at ${parsed.location}` : "",
    cat ? `under ${cat.name}` : "",
    parsed.reminderLabel ? `with a reminder ${parsed.reminderLabel}` : "",
  ].filter(Boolean);
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

type DayOpts = { only?: "events" | "work" | "classes"; evening?: boolean; cls?: Category };

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
  for (let d = ref.start; d < ref.end && days.length < 14; d = addDays(d, 1)) if (d >= startOfDay(now) || opts.only === undefined) days.push(d);
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
  const body = rows
    .slice(0, 7)
    .map((r) => {
      const shown = r.lines.slice(0, 4);
      const more = r.lines.length - shown.length;
      return `- **${dayName(r.day, now) === "today" || dayName(r.day, now) === "tomorrow" ? cap(dayName(r.day, now)) : format(r.day, "EEE, MMM d")}** — ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}`;
    })
    .join("\n");
  return { text: `${cap(ref.label)} you have ${bold(summary)}:\n${body}` };
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
  if (!done.length) return { text: `You haven't finished anything ${label} yet.` };
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
  if (ref && ref.kind === "range" && ref.end.getTime() - ref.start.getTime() > 3 * 86_400_000) return null;
  const time = findTime(q);
  const day = ref?.kind === "day" ? ref.day : ref?.kind === "range" ? ref.start : startOfDay(now);
  const label = ref?.kind === "day" ? ref.label : ref?.kind === "range" ? ref.label : "today";
  if (ref?.kind === "range") {
    const evs = ctx.items.filter((i) => i.type === "event" && +new Date(i.at) >= +ref.start && +new Date(i.at) < +ref.end).sort(byAt);
    if (!evs.length) return { text: `Nothing on your calendar ${label} — you're completely free.` };
    return { text: `${cap(label)} you have ${joinNatural(evs.slice(0, 5).map((e) => `${bold(e.title)} (${dayName(new Date(e.at), now)}${e.allDay ? "" : ` at ${fmtTime(e.at, ctx.clock24h)}`})`))}${evs.length > 5 ? `, plus ${evs.length - 5} more` : ""}; the rest of the time is open.` };
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
  if (target.kind === "none") return null;
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
  if (/\b(?:free|time|room|space|gap|gaps|openings?|questions?|idea|problem|issue|to do)\b/.test(phrase) || /^(?:due|overdue|stuff|things|classes|class|plans?|homework|assignments?|tasks?|events?)\b/.test(phrase) && !/\b(?:for|in)\b/.test(phrase)) {
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

const COMPOUND = /\s+(?:and then|then|and also|also|;)\s+|\s+and\s+(?=(?:mark|move|delete|add|remove|complete|reschedule|push|cancel|rename|finish|start)\b)/;
const FOLLOW_UP = /^(?:and\s+|what about\s+|how about\s+|what of\s+|and what about\s+|then\s+)(.+)$/;

function questionNeedsContext(q: string): boolean {
  return /\b(?:same|instead|that one|the other|another one|before that|after that|earlier one|later one|previous|last one)\b/.test(q);
}

function run(env: Env): Outcome {
  const pipeline: Array<(e: Env) => Outcome> = [
    smallTalk,
    reminderIntent,
    moveIntent,
    deleteIntent,
    renameIntent,
    completeIntent,
    addIntent,
    focusIntent,
    freeIntent,
    busiestIntent,
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

function isMutation(r: AssistantResponse): boolean {
  return Boolean(r.actions?.length);
}

/**
 * Answer from the calendar on this device, or return `null` to let the model
 * have it. Anything ambiguous, multi-part, advisory, or context-dependent is
 * `null` on purpose.
 */
export function tryLocalAnswer(
  message: string,
  history: AssistantTurn[],
  ctx: AssistantCtx,
  now: Date = new Date(),
  depth = 0
): AssistantResponse | null {
  const raw = message.trim();
  if (!raw || raw.length > 260) return null;

  if (/\n/.test(raw) || raw.length > 90) {
    const list = pastedListIntent({ ctx, now, raw, n: raw, q: expand(raw), history });
    return list ?? null;
  }

  let n = normalize(raw);
  // "thanks!" is all filler — keep it so small talk can answer it.
  if (!n) n = raw.replace(/[?!.]+$/, "").trim();
  if (!n) return null;
  const q = expand(n);
  const env: Env = { ctx, now, raw, n, q, history };

  if (NEEDS_REASONING.test(q) && !/^(?:what|which) (?:should|do) i (?:work on|do|tackle|start with|focus on)/.test(q)) return null;
  if (COMPOUND.test(q) && /\b(?:mark|move|delete|add|remove|complete|reschedule|push|cancel|rename|finish|start)\b/.test(q)) return null;
  if (questionNeedsContext(q)) return null;

  // A reply to a question the assistant just asked ("Which one?") needs the thread.
  const lastAssistant = [...history].reverse().find((t) => t.role === "assistant");
  if (lastAssistant && /\?\s*$/.test(lastAssistant.text) && q.split(" ").length <= 5 && !/^(?:what|when|where|who|which|how|do|did|am|is|are|add|move|delete|mark|show|list)\b/.test(q) && !/^(?:hi|hey|hello|thanks|thank you|ok|okay)$/.test(q)) {
    return null;
  }

  // "what about friday?" — the previous question again, with a new day.
  const followUp = FOLLOW_UP.exec(q);
  if (followUp && depth === 0) {
    const ref = findDayRef(followUp[1], now);
    const prev = [...history].reverse().find((t) => t.role === "user");
    if (!ref || !prev) return null;
    const prevQ = expand(normalize(prev.text));
    if (/^(?:add|create|move|delete|remove|cancel|rename|mark|schedule|push|remind|reschedule)/.test(prevQ) || ref === null) return null;
    const prevRef = findDayRef(prevQ, now);
    const merged = prevRef ? prevQ.replace(prevRef.text, ref.text) : `${prevQ} ${ref.text}`;
    const result = tryLocalAnswer(merged, history.slice(0, -0), ctx, now, 1);
    return result && !isMutation(result) ? result : null;
  }

  const out = run(env);
  if (!out) return null;
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
