import { addDays, isSameDay, isToday, isTomorrow, isWithinInterval, nextDay, setHours, setMinutes, format } from "date-fns";
import { WEEKDAYS } from "./quick-add-parser";
import type { Category, Item } from "./types";

export interface AssistantAction {
  type: "move";
  itemId: string;
  itemTitle: string;
  fromLabel: string;
  toLabel: string;
  newAt: string;
}

export interface AssistantResponse {
  text: string;
  suggestions: string[];
  action?: AssistantAction;
}

interface Context {
  items: Item[];
  categories: Category[];
}

/**
 * Local stand-in for the Gemini "ask" tool-call loop — same response shape the
 * server action will eventually return, scoped read (and confirm-then-write)
 * access to the signed-in user's own items.
 */
export function answerQuery(query: string, ctx: Context): AssistantResponse {
  const q = query.trim().toLowerCase();

  const moveMatch = q.match(/move\s+(.+?)\s+to\s+(\w+)/i);
  if (moveMatch) return handleMove(moveMatch[1], moveMatch[2], ctx);

  if (/due this week|this week/.test(q)) return dueThisWeek(ctx);
  if (/due today|today/.test(q)) return dueToday(ctx);
  if (/next week|coming week/.test(q)) return nextWeekPreview(ctx);
  if (/busiest/.test(q)) return busiestDay(ctx);

  const assignmentsLeft = ctx.items.filter((i) => i.type !== "event" && i.status !== "done").length;
  return {
    text:
      assignmentsLeft === 0
        ? "You're all caught up — nothing outstanding right now."
        : `You have ${assignmentsLeft} open assignment${assignmentsLeft === 1 ? "" : "s"} across your calendar. Ask me what's due this week, or tell me to move something.`,
    suggestions: ["What's due this week?", "What's due today?", "What's my busiest day?"],
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
    text:
      due.length === 0
        ? "Nothing due today."
        : `Due today: ${due.map((i) => i.title).join(", ")}.`,
    suggestions: ["What's due this week?", "What's my busiest day?"],
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

function handleMove(titleFragment: string, weekdayName: string, ctx: Context): AssistantResponse {
  const needle = titleFragment.trim().toLowerCase();
  const match = ctx.items.find((i) => i.title.toLowerCase().includes(needle));
  const dow = WEEKDAYS[weekdayName.toLowerCase()];

  if (!match) {
    return {
      text: `I couldn't find anything matching "${titleFragment}" on your calendar.`,
      suggestions: ["What's due this week?"],
    };
  }
  if (dow === undefined) {
    return {
      text: `I found "${match.title}", but I didn't catch which day to move it to.`,
      suggestions: ["What's due this week?"],
    };
  }

  const original = new Date(match.at);
  let target = nextDay(new Date(), dow);
  if (isSameDay(target, new Date())) target = addDays(target, 7);
  target = setMinutes(setHours(target, original.getHours()), original.getMinutes());

  return {
    text: `I found "${match.title}" currently due ${format(original, "EEEE 'at' h:mm a")}. Move it to ${format(
      target,
      "EEEE 'at' h:mm a"
    )}?`,
    suggestions: [],
    action: {
      type: "move",
      itemId: match.id,
      itemTitle: match.title,
      fromLabel: format(original, "EEEE, MMM d"),
      toLabel: format(target, "EEEE, MMM d"),
      newAt: target.toISOString(),
    },
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
