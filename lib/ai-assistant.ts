import {
  addDays,
  endOfMonth,
  format,
  isSameDay,
  isToday,
  isTomorrow,
  isWithinInterval,
  nextDay,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  type Day,
} from "date-fns";
import { parseQuickAdd, WEEKDAYS } from "./quick-add-parser";
import type { Category, Item, ItemStatus, ItemType } from "./types";

export type AssistantAction =
  | {
      kind: "create";
      draft: { categoryId: string; type: ItemType; title: string; at: string; status?: ItemStatus };
      preview: string;
      confirmLabel: string;
    }
  | {
      kind: "reschedule";
      itemId: string;
      itemTitle: string;
      newAt: string;
      preview: string;
      confirmLabel: string;
    }
  | {
      kind: "rename";
      itemId: string;
      itemTitle: string;
      newTitle: string;
      preview: string;
      confirmLabel: string;
    }
  | {
      kind: "status";
      itemId: string;
      itemTitle: string;
      newStatus: ItemStatus;
      preview: string;
      confirmLabel: string;
    }
  | {
      kind: "delete";
      itemId: string;
      itemTitle: string;
      preview: string;
      confirmLabel: string;
    };

export interface AssistantResponse {
  text: string;
  suggestions: string[];
  action?: AssistantAction;
}

interface Context {
  items: Item[];
  categories: Category[];
}

const DEFAULT_SUGGESTIONS = ["What's due this week?", "What's next?", "What's my busiest day?"];

/**
 * Local stand-in for the Gemini "ask" tool-call loop — same response shape the
 * server action will eventually return, scoped read (and confirm-then-write)
 * access to the signed-in user's own items. Classifies intent first (create,
 * delete, status change, rename, reschedule) before falling back to answering
 * as a plain question about the calendar.
 */
export function answerQuery(query: string, ctx: Context): AssistantResponse {
  const text = query.trim();
  if (!text) return { text: "Ask me anything about your schedule.", suggestions: DEFAULT_SUGGESTIONS };

  return (
    tryCreate(text, ctx) ??
    tryDelete(text, ctx) ??
    tryStatus(text, ctx) ??
    tryRename(text, ctx) ??
    tryReschedule(text, ctx) ??
    answerQuestion(text, ctx)
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

function tryCreate(text: string, ctx: Context): AssistantResponse | null {
  const m =
    text.match(/^(?:please\s+)?(?:add|create|schedule|new|plan|book|set up)\s+(.+)$/i) ??
    text.match(/^remind me to\s+(.+)$/i);
  if (!m) return null;

  const parsed = parseQuickAdd(m[1], ctx.categories);
  const categoryId =
    parsed.categoryId ?? ctx.categories.find((c) => !c.archived)?.id ?? ctx.categories[0]?.id ?? "";
  const categoryName = ctx.categories.find((c) => c.id === categoryId)?.name;
  const status: ItemStatus | undefined = parsed.type !== "event" ? "todo" : undefined;

  const when = format(parsed.at, "EEEE, MMM d 'at' h:mm a");
  return {
    text: `Add "${parsed.title}" — ${when}?`,
    suggestions: [],
    action: {
      kind: "create",
      draft: { categoryId, type: parsed.type, title: parsed.title, at: parsed.at.toISOString(), status },
      preview: `${categoryName ? `${categoryName} · ` : ""}${when}`,
      confirmLabel: "Add",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Delete                                                               */
/* ------------------------------------------------------------------ */

function tryDelete(text: string, ctx: Context): AssistantResponse | null {
  const m = text.match(/^(?:please\s+)?(?:delete|remove|cancel|clear|drop)\s+(?:the\s+)?(.+)$/i);
  if (!m) return null;

  const needle = m[1].replace(/\s+(from (my )?calendar|off (my )?calendar|please)\s*$/i, "").trim();
  const match = findBestMatch(ctx.items, needle);
  if (!match) {
    return { text: `I couldn't find anything matching "${needle}" to delete.`, suggestions: DEFAULT_SUGGESTIONS };
  }

  return {
    text: `Delete "${match.title}" — ${describeWhen(new Date(match.at))}?`,
    suggestions: [],
    action: {
      kind: "delete",
      itemId: match.id,
      itemTitle: match.title,
      preview: describeWhen(new Date(match.at)),
      confirmLabel: "Delete",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Status (mark done / in progress / reopen)                           */
/* ------------------------------------------------------------------ */

const STATUS_PATTERNS: [RegExp, ItemStatus][] = [
  [/^(?:mark|set)\s+(.+?)\s+as\s+(?:done|complete|completed|finished)\s*$/i, "done"],
  [/^(?:complete|finish)\s+(.+)$/i, "done"],
  [/^(?:mark|set)\s+(.+?)\s+as\s+(?:doing|in progress|started)\s*$/i, "doing"],
  [/^(?:mark|set)\s+(.+?)\s+as\s+(?:not done|todo|incomplete|not started)\s*$/i, "todo"],
  [/^reopen\s+(.+)$/i, "todo"],
];

function tryStatus(text: string, ctx: Context): AssistantResponse | null {
  for (const [re, status] of STATUS_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;

    const needle = m[1].trim();
    const match = findBestMatch(ctx.items, needle);
    if (!match) {
      return { text: `I couldn't find anything matching "${needle}".`, suggestions: DEFAULT_SUGGESTIONS };
    }
    if (match.status === undefined) {
      return { text: `"${match.title}" is an event, not a task — nothing to mark.`, suggestions: DEFAULT_SUGGESTIONS };
    }

    const label = status === "done" ? "done" : status === "doing" ? "in progress" : "not started";
    return {
      text: `Mark "${match.title}" as ${label}?`,
      suggestions: [],
      action: {
        kind: "status",
        itemId: match.id,
        itemTitle: match.title,
        newStatus: status,
        preview: `${match.title} → ${label}`,
        confirmLabel: "Mark",
      },
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rename                                                               */
/* ------------------------------------------------------------------ */

function tryRename(text: string, ctx: Context): AssistantResponse | null {
  const m = text.match(/^rename\s+(.+?)\s+to\s+(.+)$/i);
  if (!m) return null;

  const match = findBestMatch(ctx.items, m[1].trim());
  if (!match) {
    return { text: `I couldn't find anything matching "${m[1].trim()}" to rename.`, suggestions: DEFAULT_SUGGESTIONS };
  }

  const newTitle = m[2].trim();
  return {
    text: `Rename "${match.title}" to "${newTitle}"?`,
    suggestions: [],
    action: {
      kind: "rename",
      itemId: match.id,
      itemTitle: match.title,
      newTitle,
      preview: `${match.title} → ${newTitle}`,
      confirmLabel: "Rename",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Reschedule (move/push/shift X to <date/time phrase>)                */
/* ------------------------------------------------------------------ */

function tryReschedule(text: string, ctx: Context): AssistantResponse | null {
  const m = text.match(/^(?:move|reschedule|push|shift)\s+(.+?)\s+to\s+(.+)$/i);
  if (!m) return null;

  const match = findBestMatch(ctx.items, m[1].trim());
  if (!match) {
    return { text: `I couldn't find anything matching "${m[1].trim()}" on your calendar.`, suggestions: DEFAULT_SUGGESTIONS };
  }

  const original = new Date(match.at);
  const target = parseDatePhrase(m[2], { hour: original.getHours(), minute: original.getMinutes() });
  if (!target) {
    return { text: `I found "${match.title}", but I didn't catch when to move it to.`, suggestions: DEFAULT_SUGGESTIONS };
  }

  return {
    text: `Move "${match.title}" from ${format(original, "EEE, MMM d 'at' h:mm a")} to ${format(
      target,
      "EEE, MMM d 'at' h:mm a"
    )}?`,
    suggestions: [],
    action: {
      kind: "reschedule",
      itemId: match.id,
      itemTitle: match.title,
      newAt: target.toISOString(),
      preview: `${format(original, "EEE, MMM d")} → ${format(target, "EEE, MMM d 'at' h:mm a")}`,
      confirmLabel: "Move",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Questions                                                            */
/* ------------------------------------------------------------------ */

function answerQuestion(text: string, ctx: Context): AssistantResponse {
  if (/\b(what'?s next|next up|next event|next thing)\b/i.test(text)) return nextUp(ctx);
  if (/\boverdue\b/i.test(text)) return overdue(ctx);

  const day = extractDay(text);
  if (day && /\b(free|anything|what'?s on|happening|what do i have|do i have)\b/i.test(text)) {
    return dayAgenda(day, ctx, /\bfree\b/i.test(text));
  }

  if (/\bthis month\b/i.test(text)) return dueThisMonth(ctx);
  if (/due this week|this week/i.test(text)) return dueThisWeek(ctx);
  if (/due today|today/i.test(text)) return dueToday(ctx);
  if (/next week|coming week/i.test(text)) return nextWeekPreview(ctx);
  if (/busiest/i.test(text)) return busiestDay(ctx);
  if (/\bhow many\b/i.test(text)) return howMany(text, ctx);

  const categoryQuery = text.match(/^(?:what'?s due for|show me|what do i have for|what'?s on for)\s+(.+)$/i);
  if (categoryQuery) return categoryAgenda(categoryQuery[1], ctx);

  if (/\b(everything|list all|show all|show everything|what'?s on my calendar)\b/i.test(text)) {
    return listUpcoming(ctx);
  }

  const assignmentsLeft = ctx.items.filter((i) => i.type !== "event" && i.status !== "done").length;
  return {
    text:
      assignmentsLeft === 0
        ? "You're all caught up — nothing outstanding right now."
        : `You have ${assignmentsLeft} open assignment${assignmentsLeft === 1 ? "" : "s"} across your calendar. Ask me what's due this week, or tell me to move something.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function nextUp(ctx: Context): AssistantResponse {
  const now = new Date();
  const upcoming = ctx.items
    .filter((i) => i.status !== "done" && new Date(i.at).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const next = upcoming[0];
  return {
    text: next ? `Next up: "${next.title}" — ${describeWhen(new Date(next.at))}.` : "Nothing coming up on your calendar.",
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function overdue(ctx: Context): AssistantResponse {
  const now = new Date();
  const items = ctx.items.filter(
    (i) => i.type !== "event" && i.status !== "done" && new Date(i.at).getTime() < now.getTime()
  );
  return {
    text: items.length === 0 ? "Nothing overdue — you're on top of it." : `${items.length} overdue: ${items.map((i) => i.title).join(", ")}.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function dayAgenda(day: Date, ctx: Context, framedAsFree: boolean): AssistantResponse {
  const items = ctx.items
    .filter((i) => isSameDay(new Date(i.at), day))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const label = isToday(day) ? "today" : isTomorrow(day) ? "tomorrow" : format(day, "EEEE");

  if (items.length === 0) {
    return {
      text: framedAsFree ? `You're free ${label}.` : `Nothing on your calendar ${label}.`,
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  const list = items.map((i) => `${i.title} (${format(new Date(i.at), "h:mm a")})`).join(", ");
  return {
    text: framedAsFree
      ? `Not quite — you have ${items.length} thing${items.length === 1 ? "" : "s"} ${label}: ${list}.`
      : `${capitalize(label)}: ${list}.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function dueThisWeek(ctx: Context): AssistantResponse {
  const now = new Date();
  const end = addDays(now, 7);
  const due = ctx.items.filter(
    (i) => i.type !== "event" && i.status !== "done" && isWithinInterval(new Date(i.at), { start: now, end })
  );
  const counts = new Map<string, number>();
  for (const i of due) {
    const key = format(new Date(i.at), "EEEE");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    text:
      due.length === 0
        ? "Nothing due in the next 7 days. Enjoy the breathing room."
        : `You have ${due.length} assignment${due.length === 1 ? "" : "s"} due this week.${
            busiest ? ` ${busiest[0]} is your busiest day.` : ""
          }`,
    suggestions: busiest ? [`Show me ${busiest[0]}`, "What's next week look like?"] : ["What's due today?"],
  };
}

function dueToday(ctx: Context): AssistantResponse {
  const due = ctx.items.filter((i) => i.type !== "event" && i.status !== "done" && isToday(new Date(i.at)));
  return {
    text: due.length === 0 ? "Nothing due today." : `Due today: ${due.map((i) => i.title).join(", ")}.`,
    suggestions: ["What's due this week?", "What's my busiest day?"],
  };
}

function dueThisMonth(ctx: Context): AssistantResponse {
  const now = new Date();
  const start = startOfMonth(now);
  const end = endOfMonth(now);
  const due = ctx.items.filter(
    (i) => i.type !== "event" && i.status !== "done" && isWithinInterval(new Date(i.at), { start, end })
  );
  return {
    text: due.length === 0 ? "Nothing due this month." : `${due.length} assignment${due.length === 1 ? "" : "s"} due this month: ${due.map((i) => i.title).join(", ")}.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function nextWeekPreview(ctx: Context): AssistantResponse {
  const start = addDays(new Date(), 7);
  const end = addDays(new Date(), 14);
  const due = ctx.items.filter(
    (i) => i.type !== "event" && i.status !== "done" && isWithinInterval(new Date(i.at), { start, end })
  );
  return {
    text:
      due.length === 0
        ? "Next week is wide open so far."
        : `${due.length} assignment${due.length === 1 ? "" : "s"} due next week: ${due.map((i) => i.title).join(", ")}.`,
    suggestions: ["What's due this week?"],
  };
}

function busiestDay(ctx: Context): AssistantResponse {
  const now = new Date();
  const end = addDays(now, 7);
  const upcoming = ctx.items.filter((i) => isWithinInterval(new Date(i.at), { start: now, end }));
  const counts = new Map<string, { count: number; label: string }>();
  for (const i of upcoming) {
    const d = new Date(i.at);
    const key = format(d, "yyyy-MM-dd");
    const label = isToday(d) ? "today" : isTomorrow(d) ? "tomorrow" : format(d, "EEEE");
    const existing = counts.get(key);
    counts.set(key, { count: (existing?.count ?? 0) + 1, label });
  }
  const busiest = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return {
    text: busiest
      ? `${capitalize(busiest.label)} is your busiest day this week, with ${busiest.count} thing${busiest.count === 1 ? "" : "s"} on it.`
      : "Nothing on the calendar this week yet.",
    suggestions: ["What's due this week?"],
  };
}

function howMany(text: string, ctx: Context): AssistantResponse {
  const t = text.toLowerCase();
  let pool = ctx.items;
  let label = "on your calendar";

  if (/\bevents?\b/.test(t)) pool = pool.filter((i) => i.type === "event");
  else if (/\b(assignments?|tasks?|to-?dos?)\b/.test(t)) pool = pool.filter((i) => i.type !== "event");

  const now = new Date();
  if (/\btoday\b/.test(t)) {
    pool = pool.filter((i) => isToday(new Date(i.at)));
    label = "today";
  } else if (/\bthis week\b/.test(t)) {
    pool = pool.filter((i) => isWithinInterval(new Date(i.at), { start: now, end: addDays(now, 7) }));
    label = "this week";
  } else if (/\bthis month\b/.test(t)) {
    pool = pool.filter((i) => isWithinInterval(new Date(i.at), { start: startOfMonth(now), end: endOfMonth(now) }));
    label = "this month";
  }

  if (/\b(left|open|outstanding|remaining)\b/.test(t)) pool = pool.filter((i) => i.status !== "done");

  return { text: `You have ${pool.length} ${pool.length === 1 ? "item" : "items"} ${label}.`, suggestions: DEFAULT_SUGGESTIONS };
}

function categoryAgenda(nameRaw: string, ctx: Context): AssistantResponse {
  const name = nameRaw.replace(/[?.!]+$/, "").trim().toLowerCase();
  const cat = ctx.categories.find((c) => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase()));
  if (!cat) {
    return { text: `I don't have a category matching "${nameRaw}".`, suggestions: DEFAULT_SUGGESTIONS };
  }

  const items = ctx.items
    .filter((i) => i.categoryId === cat.id && i.status !== "done")
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    text:
      items.length === 0
        ? `Nothing outstanding for ${cat.name}.`
        : `${cat.name}: ${items.map((i) => `${i.title} (${describeWhen(new Date(i.at))})`).join(", ")}.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

function listUpcoming(ctx: Context): AssistantResponse {
  const now = startOfDay(new Date());
  const items = ctx.items
    .filter((i) => i.status !== "done" && new Date(i.at).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 8);

  if (items.length === 0) return { text: "Your calendar is empty — nothing upcoming.", suggestions: DEFAULT_SUGGESTIONS };
  return {
    text: `Here's what's coming up: ${items.map((i) => `${i.title} (${describeWhen(new Date(i.at))})`).join(", ")}.`,
    suggestions: DEFAULT_SUGGESTIONS,
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

function findBestMatch(items: Item[], needleRaw: string): Item | undefined {
  const needle = needleRaw.toLowerCase().trim();
  if (!needle) return undefined;
  const candidates = items.filter((i) => i.title.toLowerCase().includes(needle));
  return candidates.sort((a, b) => {
    const doneA = a.status === "done" ? 1 : 0;
    const doneB = b.status === "done" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    return new Date(a.at).getTime() - new Date(b.at).getTime();
  })[0];
}

function extractDay(text: string): Date | null {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) return addDays(startOfDay(new Date()), 1);
  if (/\btoday\b/.test(t)) return startOfDay(new Date());
  for (const [name, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) return nextDay(startOfDay(new Date()), dow as Day);
  }
  return null;
}

/** Parses a trailing date/time phrase like "tomorrow at 5pm" or "friday",
 *  falling back to the given time-of-day when no explicit time is found. */
function parseDatePhrase(phraseRaw: string, fallback: { hour: number; minute: number }): Date | null {
  let text = phraseRaw.trim();
  let base = startOfDay(new Date());
  let matchedDate = false;

  if (/\btomorrow\b/i.test(text)) {
    base = addDays(base, 1);
    matchedDate = true;
    text = text.replace(/\btomorrow\b/i, "").trim();
  } else if (/\btoday\b/i.test(text)) {
    matchedDate = true;
    text = text.replace(/\btoday\b/i, "").trim();
  } else if (/\bnext week\b/i.test(text)) {
    base = addDays(base, 7);
    matchedDate = true;
    text = text.replace(/\bnext week\b/i, "").trim();
  } else {
    for (const [name, dow] of Object.entries(WEEKDAYS)) {
      const re = new RegExp(`\\b${name}\\b`, "i");
      if (re.test(text)) {
        base = nextDay(startOfDay(new Date()), dow as Day);
        matchedDate = true;
        text = text.replace(re, "").trim();
        break;
      }
    }
  }

  let hour = fallback.hour;
  let minute = fallback.minute;
  let matchedTime = false;
  const timeMatch = text.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)\b/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const isPM = /pm/i.test(timeMatch[4]);
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    hour = h;
    minute = m;
    matchedTime = true;
  }

  if (!matchedDate && !matchedTime) return null;
  return setMinutes(setHours(base, hour), minute);
}

function describeWhen(d: Date): string {
  if (isToday(d)) return `today at ${format(d, "h:mm a")}`;
  if (isTomorrow(d)) return `tomorrow at ${format(d, "h:mm a")}`;
  return format(d, "EEEE, MMM d 'at' h:mm a");
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
