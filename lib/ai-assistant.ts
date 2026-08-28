import {
  addDays,
  addWeeks,
  differenceInCalendarDays,
  format,
  isSameDay,
  isToday,
  isTomorrow,
  isWithinInterval,
  nextDay,
  parse,
  setHours,
  setMinutes,
  startOfDay,
} from "date-fns";
import { thisOrNextWeekday } from "./date-utils";
import { WEEKDAYS, parseQuickAdd } from "./quick-add-parser";
import type { Category, Item, ItemStatus } from "./types";

/* ------------------------------------------------------------------ */
/* Public types (shared with app/api/assistant/route.ts's output)      */
/* ------------------------------------------------------------------ */

export type AssistantAction =
  | { kind: "create"; summary: string; draft: Omit<Item, "id" | "createdAt"> }
  | { kind: "update"; summary: string; itemId: string; itemTitle: string; patch: Partial<Item> }
  | { kind: "delete"; summary: string; itemId: string; itemTitle: string };

export interface AssistantResponse {
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
  /** True when the network assistant couldn't be reached and this is the
   *  offline heuristic answer — the UI offers a retry. */
  degraded?: boolean;
}

export interface AssistantTurn {
  role: "user" | "assistant";
  text: string;
}

interface Ctx {
  items: Item[];
  categories: Category[];
  clock24h: boolean;
  weekStartsOn?: 0 | 1;
}

/** Compact facts pre-computed for the model and offline heuristics. */
export interface AssistantDigest {
  dueToday: DigestEntry[];
  dueThisWeek: DigestEntry[];
  dueByNextSunday: DigestEntry[];
  overdue: DigestEntry[];
  inProgress: DigestEntry[];
  completedLast7Days: { count: number; titles: string[] };
  nextEvent?: DigestEntry;
}

export interface DigestEntry {
  id: string;
  title: string;
  type: Item["type"];
  status?: ItemStatus;
  at: string;
  categoryName?: string;
}

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Local calendar day as yyyy-MM-dd in an IANA timezone. */
export function zonedDateKey(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function zonedWeekday(instant: Date | string, timeZone: string): number {
  const w =
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" })
      .formatToParts(new Date(instant))
      .find((p) => p.type === "weekday")?.value ?? "Sun";
  return WEEKDAY_SHORT[w] ?? 0;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function nextSundayDateKey(now: Date, timeZone: string): string {
  const todayKey = zonedDateKey(now, timeZone);
  const dow = zonedWeekday(now, timeZone);
  return addDaysToDateKey(todayKey, dow === 0 ? 0 : 7 - dow);
}

/** Last day of the user's calendar week as yyyy-MM-dd (Sat if week starts Sun, Sun if week starts Mon). */
function endOfCalendarWeekKey(now: Date, timeZone: string, weekStartsOn: 0 | 1): string {
  const todayKey = zonedDateKey(now, timeZone);
  const dow = zonedWeekday(now, timeZone);
  const weekEndDow = weekStartsOn === 0 ? 6 : 0;
  return addDaysToDateKey(todayKey, (weekEndDow - dow + 7) % 7);
}

function categoryNameFor(id: string | undefined, categories: Pick<Category, "id" | "name">[]): string | undefined {
  if (!id) return undefined;
  return categories.find((c) => c.id === id)?.name;
}

function isOpenWork(item: Item): boolean {
  return item.type !== "event" && item.status !== "done";
}

function isOverdueOpen(item: Item, now: Date, timeZone: string): boolean {
  if (!isOpenWork(item)) return false;
  const at = new Date(item.at);
  if (item.allDay) return zonedDateKey(at, timeZone) < zonedDateKey(now, timeZone);
  return at.getTime() < now.getTime();
}

function toDigestEntry(item: Item, categories: Pick<Category, "id" | "name">[]): DigestEntry {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    at: item.at,
    categoryName: categoryNameFor(item.categoryId, categories),
  };
}

/** Pre-compute schedule facts so the model and offline engine share one source of truth. */
export function buildAssistantDigest(
  items: Item[],
  categories: Pick<Category, "id" | "name">[],
  nowIso: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStartsOn: 0 | 1 = 0
): AssistantDigest {
  const now = new Date(nowIso);
  const todayKey = zonedDateKey(now, timeZone);
  const weekEndKey = endOfCalendarWeekKey(now, timeZone, weekStartsOn);
  const sundayKey = nextSundayDateKey(now, timeZone);
  const completedSinceKey = addDaysToDateKey(todayKey, -6);

  const openWork = items.filter(isOpenWork).sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const dueToday = openWork.filter((i) => zonedDateKey(i.at, timeZone) === todayKey);
  const dueThisWeek = openWork.filter((i) => {
    const k = zonedDateKey(i.at, timeZone);
    return k >= todayKey && k <= weekEndKey;
  });
  const dueByNextSunday = openWork.filter((i) => zonedDateKey(i.at, timeZone) <= sundayKey);
  const overdue = openWork.filter((i) => isOverdueOpen(i, now, timeZone));
  const inProgress = openWork.filter((i) => i.status === "doing");

  const completed = items
    .filter((i) => {
      if (i.type === "event" || i.status !== "done") return false;
      const when = i.completedAt ?? i.at;
      const k = zonedDateKey(when, timeZone);
      return k >= completedSinceKey && k <= todayKey;
    })
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));

  const nextEvent = items
    .filter((i) => i.type === "event" && new Date(i.at).getTime() >= now.getTime())
    .sort((a, b) => +new Date(a.at) - +new Date(b.at))[0];

  return {
    dueToday: dueToday.map((i) => toDigestEntry(i, categories)),
    dueThisWeek: dueThisWeek.map((i) => toDigestEntry(i, categories)),
    dueByNextSunday: dueByNextSunday.map((i) => toDigestEntry(i, categories)),
    overdue: overdue.map((i) => toDigestEntry(i, categories)),
    inProgress: inProgress.map((i) => toDigestEntry(i, categories)),
    completedLast7Days: {
      count: completed.length,
      titles: completed.slice(0, 12).map((i) => i.title),
    },
    nextEvent: nextEvent ? toDigestEntry(nextEvent, categories) : undefined,
  };
}

function asksAboutCompletedWork(q: string): boolean {
  return /\b(finished|completed|complete|did i finish|what did i|have i finished|checked off|done with)\b/.test(q);
}

const STARTER_SUGGESTIONS = [
  "What's on today?",
  "What's due this week?",
  "Add gym at 6pm tomorrow",
  "Move my essay to Sunday",
];

/* Verbs that act on something already on the calendar — these belong to the
 * assistant (which resolves the target and proposes a change), not to quick-add
 * (which only ever creates a brand-new item). */
const COMMAND_VERBS =
  /^(move|reschedule|push|bump|shift|delete|remove|cancel|clear|rename|retitle|mark|complete|finish|check off|reopen|un-?complete|undo)\b/i;

/* Openers that signal a question rather than a thing to remember. */
const QUESTION_OPENERS =
  /^(what|whats|when|whens|where|wheres|which|who|why|how|do i|did i|have i|am i|are there|is there|will i|can you|could you|should i|show me|list|tell me|remind me what|how many|how much|when'?s)\b/i;

/**
 * Decide whether text typed into the quick-add bar is really a question or a
 * change request (→ hand to the assistant) rather than a new item to create.
 */
export function shouldAskAssistant(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  if (QUESTION_OPENERS.test(t)) return true;
  if (COMMAND_VERBS.test(t)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Entry point — Gemini via /api/assistant, local heuristics fallback  */
/* ------------------------------------------------------------------ */

export async function askAssistant(
  message: string,
  history: AssistantTurn[],
  ctx: Ctx
): Promise<AssistantResponse> {
  // Hard ceiling so a hung request can never wedge the chat — the server does
  // its own 30s abort on the model call, this is the outer safety net.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const { authHeaders } = await import("./auth-headers");
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: await authHeaders(),
      signal: controller.signal,
      body: JSON.stringify({
        message,
        history: history.slice(-10),
        now: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clock24h: ctx.clock24h,
        weekStartsOn: ctx.weekStartsOn ?? 0,
        items: ctx.items.map((i) => ({
          id: i.id,
          title: i.title,
          type: i.type,
          at: i.at,
          endAt: i.endAt,
          allDay: i.allDay,
          status: i.status,
          categoryId: i.categoryId,
          location: i.location,
          description: i.description,
          url: i.url,
        })),
        categories: ctx.categories.map((c) => ({ id: c.id, name: c.name })),
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as AssistantResponse & { error?: string };
      if (!data.error && typeof data.text === "string") {
        return {
          text: data.text,
          suggestions: data.suggestions,
          actions: sanitizeActions(data.actions, ctx),
        };
      }
      if (data.error === "assistant-busy") {
        return {
          text: "The assistant's a bit overloaded right now — give it a few seconds and tap retry.",
          degraded: true,
        };
      }
    }
  } catch {
    /* offline / timeout / server error — fall through to the local engine */
  } finally {
    clearTimeout(timer);
  }

  // A local guess at a *change* is risky (it could create a junk item), so only
  // fall back to the offline heuristic for questions. For change requests, be
  // honest and let the user retry.
  if (COMMAND_VERBS.test(message.trim()) || /^(add|create|schedule|new|set up|book|block off|remind me to)\b/i.test(message.trim())) {
    return {
      text: "I couldn't reach the assistant just now. Tap retry, or add it straight from the quick-add bar.",
      degraded: true,
    };
  }
  return { ...localAnswer(message, ctx), degraded: true };
}

/** Defensive pass over server actions before the store applies them. */
function sanitizeActions(actions: AssistantResponse["actions"], ctx: Ctx): AssistantAction[] | undefined {
  if (!Array.isArray(actions)) return undefined;
  const ids = new Set(ctx.items.map((i) => i.id));
  const catIds = new Set(ctx.categories.map((c) => c.id));
  const out: AssistantAction[] = [];
  for (const a of actions) {
    if (!a || typeof a.summary !== "string") continue;
    if (a.kind === "create") {
      if (!a.draft?.title || !a.draft?.at || Number.isNaN(+new Date(a.draft.at))) continue;
      const draft = { ...a.draft };
      if (!draft.categoryId || !catIds.has(draft.categoryId)) draft.categoryId = ctx.categories[0]?.id ?? "";
      out.push({ kind: "create", summary: a.summary, draft });
    } else if (a.kind === "update") {
      if (!ids.has(a.itemId) || !a.patch || Object.keys(a.patch).length === 0) continue;
      out.push(a);
    } else if (a.kind === "delete") {
      if (!ids.has(a.itemId)) continue;
      out.push(a);
    }
  }
  return out.length ? out : undefined;
}

/* ------------------------------------------------------------------ */
/* Local heuristic engine (no network) — covers the common asks       */
/* ------------------------------------------------------------------ */

export function localAnswer(query: string, ctx: Ctx): AssistantResponse {
  const raw = query.trim();
  const q = raw.toLowerCase();
  const fmtTime = (iso: string) => format(new Date(iso), ctx.clock24h ? "HH:mm" : "h:mm a");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();
  const digest = buildAssistantDigest(ctx.items, ctx.categories, now.toISOString(), tz, ctx.weekStartsOn ?? 0);
  const open = ctx.items.filter(isOpenWork);
  const wantsCompleted = asksAboutCompletedWork(q);

  /* --- mutations ------------------------------------------------- */

  // delete / cancel
  const del = raw.match(/^(?:delete|remove|cancel|clear)\s+(?:the\s+|my\s+)?(.+)/i);
  if (del) {
    const target = findItem(ctx.items, del[1]);
    if (!target) return miss(del[1]);
    return {
      text: `Delete “${target.title}” (${when(target, fmtTime)})?`,
      actions: [
        { kind: "delete", summary: `Delete “${target.title}”`, itemId: target.id, itemTitle: target.title },
      ],
    };
  }

  // mark done / reopen
  const done = raw.match(/^(?:mark|set)\s+(.+?)\s+(?:as\s+)?(done|complete|completed|finished)\b/i) ||
    raw.match(/^(?:complete|finish|check off)\s+(?:the\s+|my\s+)?(.+)/i);
  if (done) {
    const target = findItem(ctx.items, done[1]);
    if (!target) return miss(done[1]);
    return {
      text: `Mark “${target.title}” done?`,
      actions: [
        { kind: "update", summary: `Mark “${target.title}” done`, itemId: target.id, itemTitle: target.title, patch: { status: "done" } },
      ],
    };
  }
  const reopen = raw.match(/^(?:reopen|un-?complete|undo)\s+(?:the\s+|my\s+)?(.+)/i);
  if (reopen) {
    const target = findItem(ctx.items, reopen[1]);
    if (!target) return miss(reopen[1]);
    return {
      text: `Reopen “${target.title}”?`,
      actions: [
        { kind: "update", summary: `Reopen “${target.title}”`, itemId: target.id, itemTitle: target.title, patch: { status: "todo" } },
      ],
    };
  }

  // rename
  const rename = raw.match(/^(?:rename|retitle)\s+(.+?)\s+to\s+(.+)/i);
  if (rename) {
    const target = findItem(ctx.items, rename[1]);
    if (!target) return miss(rename[1]);
    const title = rename[2].trim().replace(/^["']|["']$/g, "");
    return {
      text: `Rename “${target.title}” to “${title}”?`,
      actions: [
        { kind: "update", summary: `Rename to “${title}”`, itemId: target.id, itemTitle: target.title, patch: { title } },
      ],
    };
  }

  // move / reschedule / push
  const move = raw.match(/^(?:move|reschedule|push|bump|shift)\s+(.+?)\s+(?:to|for|until|->)\s+(.+)/i);
  if (move) {
    const target = findItem(ctx.items, move[1]);
    if (!target) return miss(move[1]);
    const dest = resolveDate(move[2]);
    if (!dest) {
      return { text: `I found “${target.title}” but couldn't read the new date “${move[2]}”. Try "move ${move[1].trim()} to Friday" or a date like "Sep 3".` };
    }
    const orig = new Date(target.at);
    const at = setMinutes(setHours(dest, orig.getHours()), orig.getMinutes());
    return {
      text: `Move “${target.title}” from ${format(orig, "EEE, MMM d")} to ${format(at, "EEE, MMM d")}${
        target.allDay ? "" : ` at ${fmtTime(at.toISOString())}`
      }?`,
      actions: [
        {
          kind: "update",
          summary: `Move “${target.title}” to ${format(at, "EEE, MMM d")}`,
          itemId: target.id,
          itemTitle: target.title,
          patch: { at: at.toISOString() },
        },
      ],
    };
  }

  // add / create / schedule
  const add = raw.match(/^(?:add|create|new|schedule|put|set up|book|block off|remind me to)\s+(.+)/i);
  if (add) {
    const parsed = parseQuickAdd(add[1], ctx.categories);
    const cat = ctx.categories.find((c) => c.id === parsed.categoryId);
    const draft: Omit<Item, "id" | "createdAt"> = {
      title: parsed.title,
      type: parsed.type,
      categoryId: parsed.categoryId ?? ctx.categories[0]?.id ?? "",
      at: parsed.at.toISOString(),
      ...(parsed.type !== "event" ? { status: "todo" as ItemStatus } : {}),
    };
    return {
      text: `Add ${parsed.type} “${parsed.title}” on ${format(parsed.at, "EEE, MMM d")}${
        parsed.confidence.date ? ` at ${fmtTime(parsed.at.toISOString())}` : ""
      }${cat ? ` · ${cat.name}` : ""}?`,
      actions: [
        {
          kind: "create",
          summary: `Add “${parsed.title}” — ${format(parsed.at, "EEE, MMM d")}`,
          draft,
        },
      ],
    };
  }

  /* --- questions ----------------------------------------------- */

  if (/\b(overdue|late|behind|past due)\b/.test(q)) {
    const od = digest.overdue;
    return {
      text: od.length === 0 ? "Nothing overdue — you're on top of it." : `${od.length} overdue: ${digestList(od)}.`,
      suggestions: ["What's due this week?", "What's on today?"],
    };
  }

  if (wantsCompleted && !/\b(add|create|move|delete|mark|rename)\b/.test(q)) {
    const { count, titles } = digest.completedLast7Days;
    if (count === 0) return { text: "Nothing completed in the last 7 days.", suggestions: ["What's due this week?"] };
    const listed = titles.slice(0, 8).map((t) => `**${t}**`).join(", ");
    const more = count > titles.length ? ` (+${count - titles.length} more)` : "";
    return {
      text: `You finished **${count}** item${count === 1 ? "" : "s"} in the last 7 days: ${listed}${more}.`,
      suggestions: ["What's on today?", "What's due this week?"],
    };
  }

  if (/\bbusiest\b/.test(q)) return busiestDay(ctx);

  if (/(free|open|available).*(time|slot|day|today|tomorrow|week)|am i free|do i have time/.test(q)) {
    return freeTime(q, ctx, fmtTime);
  }

  // "when is X" / "when's my X"
  const whenQ = raw.match(/\bwhen(?:'s| is| are)\s+(?:my\s+|the\s+)?(.+?)\??$/i);
  if (whenQ && !/today|tomorrow|this week|next week/i.test(whenQ[1])) {
    const target = findItem(ctx.items, whenQ[1]);
    if (target) {
      const d = new Date(target.at);
      return {
        text: `“${target.title}” is ${dayPhrase(d)}${target.allDay ? "" : ` at ${fmtTime(target.at)}`} (${daysAway(d)}).`,
        suggestions: ["What else is that day?"],
      };
    }
  }

  // "what's on / do I have <day>"
  const dayQ = raw.match(/\b(?:what(?:'s| is| do i have| have i got)?|anything|what about|show me)\b.*?\b(today|tomorrow|tonight|this weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|\w+ \d{1,2})\b/i);
  if (dayQ) {
    const key = dayQ[1].toLowerCase();
    if (key === "this week") return rangeAnswer("this week", startOfDay(new Date()), addDays(startOfDay(new Date()), 7), ctx);
    if (key === "next week") return rangeAnswer("next week", addWeeks(startOfDay(new Date()), 1), addWeeks(addDays(startOfDay(new Date()), 7), 1), ctx);
    if (key === "this weekend") {
      const sat = nextDay(startOfDay(new Date()), 6);
      return rangeAnswer("this weekend", isToday(sat) ? sat : sat, addDays(sat, 2), ctx);
    }
    const d = resolveDate(key);
    if (d) return dayAnswer(d, ctx, fmtTime, wantsCompleted);
  }

  if (/due (this week|soon)|this week/.test(q)) return rangeAnswer("this week", startOfDay(new Date()), addDays(startOfDay(new Date()), 7), ctx);
  if (/next week/.test(q)) return rangeAnswer("next week", addWeeks(startOfDay(new Date()), 1), addWeeks(addDays(startOfDay(new Date()), 7), 1), ctx);
  if (/due today|what'?s? (due )?today|today/.test(q)) return dayAnswer(new Date(), ctx, fmtTime, wantsCompleted);
  if (/tomorrow/.test(q)) return dayAnswer(addDays(new Date(), 1), ctx, fmtTime, wantsCompleted);

  if (/how many|count|number of/.test(q)) {
    const wantsEvents = /\bevents?\b/.test(q);
    const wantsWork = /\b(assignments?|tasks?|homework|due|left|outstanding|open)\b/.test(q);
    const bySunday = /\b(by|before|through|until)\s+sunday\b|\bdue\s+by\s+sunday\b/.test(q);
    const thisWeek = /\bthis week\b/.test(q) && !bySunday;
    const todayBound = /\btoday\b/.test(q) && !thisWeek && !bySunday;

    if (wantsEvents && !wantsWork) {
      const events = ctx.items.filter((i) => i.type === "event" && new Date(i.at) >= startOfDay(now)).length;
      return {
        text: `You have **${events}** upcoming event${events === 1 ? "" : "s"}.`,
        suggestions: ["What's on today?", "What's due this week?"],
      };
    }

    let pool: DigestEntry[];
    let label: string;
    if (bySunday) {
      pool = digest.dueByNextSunday;
      label = "due by Sunday";
    } else if (thisWeek) {
      pool = digest.dueThisWeek;
      label = "due this week";
    } else if (todayBound) {
      pool = digest.dueToday;
      label = "due today";
    } else if (wantsWork) {
      pool = open.map((i) => toDigestEntry(i, ctx.categories));
      label = "open";
    } else {
      const events = ctx.items.filter((i) => i.type === "event" && new Date(i.at) >= startOfDay(now)).length;
      return {
        text: `You have **${open.length}** open task${open.length === 1 ? "" : "s"} and **${events}** upcoming event${events === 1 ? "" : "s"}.`,
        suggestions: ["What's due this week?", "What's my busiest day?"],
      };
    }

    const n = pool.length;
    const kind = /\bassignments?\b/.test(q) ? "assignment" : /\btasks?\b/.test(q) ? "task" : "item";
    return {
      text:
        n === 0
          ? `Nothing ${label}.`
          : `**${n}** ${kind}${n === 1 ? "" : "s"} ${label}${n <= 8 ? `: ${digestList(pool)}` : ""}.`,
      suggestions: ["What's on today?", "What's due this week?"],
    };
  }

  if (/\b(list|show|all)\b.*\bevents?\b/.test(q)) {
    const ev = ctx.items.filter((i) => i.type === "event" && new Date(i.at) >= startOfDay(new Date())).sort((a, b) => +new Date(a.at) - +new Date(b.at)).slice(0, 12);
    return { text: ev.length ? `Upcoming events: ${ev.map((e) => `${e.title} (${dayPhrase(new Date(e.at))})`).join(", ")}.` : "No upcoming events." };
  }

  /* --- default ------------------------------------------------- */
  return {
    text:
      open.length === 0
        ? "You're all caught up — nothing outstanding. Ask me about your week, or tell me to add or move something."
        : `You've got ${open.length} open item${open.length === 1 ? "" : "s"}. Ask what's due this week, what's on a given day, or tell me to add, move, or complete something.`,
    suggestions: STARTER_SUGGESTIONS,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function findItem(items: Item[], q: string): Item | undefined {
  const needle = q.trim().toLowerCase().replace(/^["']|["'?.]+$/g, "").trim();
  if (!needle) return undefined;
  return (
    items.find((i) => i.title.toLowerCase() === needle) ||
    items.find((i) => i.title.toLowerCase().includes(needle)) ||
    items.find((i) => needle.includes(i.title.toLowerCase())) ||
    items.find((i) => {
      const words = needle.split(/\s+/).filter((w) => w.length > 2);
      return words.length > 0 && words.every((w) => i.title.toLowerCase().includes(w));
    })
  );
}

function resolveDate(text: string): Date | null {
  const t = text.trim().toLowerCase().replace(/^(on|the)\s+/, "");
  const today = startOfDay(new Date());
  if (/^(today|tonight)\b/.test(t)) return today;
  if (/^tomorrow\b/.test(t)) return addDays(today, 1);
  const inDays = t.match(/^in\s+(\d+)\s+days?/);
  if (inDays) return addDays(today, parseInt(inDays[1], 10));
  const inWeeks = t.match(/^in\s+(\d+)\s+weeks?/);
  if (inWeeks) return addDays(today, parseInt(inWeeks[1], 10) * 7);
  const nextWd = t.match(/^next\s+(\w+)/);
  if (nextWd && WEEKDAYS[nextWd[1]] !== undefined) return addDays(nextDay(today, WEEKDAYS[nextWd[1]]), 7);
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`^${name}\\b`).test(t)) return thisOrNextWeekday(dow, today);
  }
  for (const fmt of ["MMMM d", "MMM d", "M/d", "MM/dd", "yyyy-MM-dd", "d MMMM", "d MMM"]) {
    const d = parse(t, fmt, new Date());
    if (!Number.isNaN(+d)) {
      if (d.getTime() < today.getTime() - 86_400_000 && !/\d{4}/.test(t)) d.setFullYear(d.getFullYear() + 1);
      return startOfDay(d);
    }
  }
  return null;
}

function when(item: Item, fmtTime: (iso: string) => string): string {
  const d = new Date(item.at);
  return `${dayPhrase(d)}${item.allDay || item.type !== "event" ? "" : ` at ${fmtTime(item.at)}`}`;
}

function dayPhrase(d: Date): string {
  if (isToday(d)) return "today";
  if (isTomorrow(d)) return "tomorrow";
  return format(d, "EEE, MMM d");
}

function daysAway(d: Date): string {
  const n = differenceInCalendarDays(startOfDay(d), startOfDay(new Date()));
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

function list(items: Item[]): string {
  return items.slice(0, 8).map((i) => `${i.title} (${dayPhrase(new Date(i.at))})`).join(", ");
}

function digestList(entries: DigestEntry[]): string {
  return entries
    .slice(0, 8)
    .map((i) => `${i.title} (${dayPhrase(new Date(i.at))})`)
    .join(", ");
}

function miss(q: string): AssistantResponse {
  return {
    text: `I couldn't find anything matching “${q.trim().replace(/[?.]+$/, "")}” on your calendar.`,
    suggestions: ["What's on today?", "What's due this week?"],
  };
}

function dayAnswer(day: Date, ctx: Ctx, fmtTime: (iso: string) => string, wantsCompleted = false): AssistantResponse {
  const on = ctx.items
    .filter((i) => {
      if (!isSameDay(new Date(i.at), day)) return false;
      if (i.type === "event") return true;
      if (wantsCompleted) return i.status === "done";
      return i.status !== "done";
    })
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const label = isToday(day) ? "today" : isTomorrow(day) ? "tomorrow" : format(day, "EEEE, MMM d");
  if (on.length === 0) {
    return {
      text: wantsCompleted ? `Nothing completed on ${label}.` : `Nothing on ${label}.`,
      suggestions: ["What's due this week?"],
    };
  }
  return {
    text: `${cap(label)}: ${on
      .map((i) => {
        if (i.status === "done") return `**${i.title}** (done)`;
        return `${i.title}${i.allDay ? " (all day)" : i.type === "event" ? ` at ${fmtTime(i.at)}` : ` (due ${fmtTime(i.at)})`}`;
      })
      .join(", ")}.`,
    suggestions: ["What about tomorrow?", "What's my busiest day?"],
  };
}

function rangeAnswer(label: string, start: Date, end: Date, ctx: Ctx): AssistantResponse {
  const inRange = ctx.items.filter((i) => isWithinInterval(new Date(i.at), { start, end }));
  const due = inRange.filter((i) => i.type !== "event" && i.status !== "done");
  const events = inRange.filter((i) => i.type === "event");
  if (inRange.length === 0) return { text: `Nothing ${label}. Enjoy the breathing room.`, suggestions: ["What's on today?"] };
  const parts: string[] = [];
  if (due.length) parts.push(`${due.length} due (${list(due)})`);
  if (events.length) parts.push(`${events.length} event${events.length === 1 ? "" : "s"} (${list(events)})`);
  return { text: `${cap(label)}: ${parts.join("; ")}.`, suggestions: ["What's my busiest day?", "What's on today?"] };
}

function busiestDay(ctx: Ctx): AssistantResponse {
  const now = new Date();
  const end = addDays(now, 7);
  const counts = new Map<string, { count: number; label: string }>();
  for (const i of ctx.items.filter((x) => isWithinInterval(new Date(x.at), { start: now, end }))) {
    const d = new Date(i.at);
    const key = format(d, "yyyy-MM-dd");
    counts.set(key, {
      count: (counts.get(key)?.count ?? 0) + 1,
      label: isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEEE"),
    });
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return {
    text: top
      ? `${top.label} is your busiest day this week — ${top.count} thing${top.count === 1 ? "" : "s"} on it.`
      : "Nothing on your calendar this week yet.",
    suggestions: ["What's due this week?"],
  };
}

function freeTime(q: string, ctx: Ctx, fmtTime: (iso: string) => string): AssistantResponse {
  const day = /tomorrow/.test(q) ? addDays(new Date(), 1) : new Date();
  const events = ctx.items
    .filter((i) => i.type === "event" && !i.allDay && isSameDay(new Date(i.at), day))
    .sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const label = isToday(day) ? "today" : "tomorrow";
  if (events.length === 0) return { text: `You have no timed events ${label} — the day's wide open.` };
  const busy = events
    .map((e) => `${fmtTime(e.at)}${e.endAt ? `–${fmtTime(e.endAt)}` : ""} ${e.title}`)
    .join(", ");
  return {
    text: `${cap(label)} you're booked: ${busy}. The gaps around those are free.`,
    suggestions: ["What's due this week?"],
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
