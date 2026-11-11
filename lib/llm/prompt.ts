import { buildAssistantDigest } from "@/lib/ai-assistant";
import { dateLookupLine, weekdayStamp } from "@/lib/assistant-dates";
import type { AssistantReqBody as ReqBody } from "@/lib/assistant-actions";
import { normalizeSyllabusInfo, syllabusDigest } from "@/lib/syllabus-info";

const SNAPSHOT_ITEMS = 140;

/** Local time with its weekday — `Thu 2026-11-12 15:00` — so the model copies
 *  weekdays instead of working them out (see lib/assistant-dates.ts). */
const localStamp = weekdayStamp;

/**
 * The snapshot is re-sent on every model call, so it is the biggest quota lever:
 * one compact line per item (local time, no urls/source ids/descriptions) instead
 * of pretty JSON with every field. Full detail is one list_* tool call away.
 */
const SYLLABUS_WORDS =
  /\b(?:syllabus|professor|prof|instructor|teacher|ta|tas|office hours?|email|contact|grad(?:e|ed|ing)|worth|weight|percent|policy|policies|late|extension|attendance|absen\w*|make-?up|regrade|extra credit|cheat\w*|plagiari\w*|integrity|ai|chatgpt|collaborat\w*|textbook|book|materials|prereq\w*|break|holiday|drop|withdraw|deadline|final|midterm|exam|allowed|rules?)\b/i;

/**
 * Syllabus details are only worth their tokens when the question is about a
 * course: the classes the message names, or every class that has details when
 * it asks something syllabus-shaped without naming one.
 */
function relevantSyllabi(body: ReqBody): string {
  const message = body.message.toLowerCase();
  const withInfo = body.categories
    .map((c) => ({ name: c.name, info: normalizeSyllabusInfo(c.syllabus) }))
    .filter((c): c is { name: string; info: NonNullable<typeof c.info> } => Boolean(c.info));
  if (!withInfo.length) return "";
  const named = withInfo.filter((c) => message.includes(c.name.toLowerCase()));
  const chosen = named.length ? named : SYLLABUS_WORDS.test(message) ? withInfo.slice(0, 4) : [];
  return chosen
    .map((c) => syllabusDigest(c.name, c.info))
    .join("\n\n")
    .slice(0, 12_000);
}

export function systemPrompt(body: ReqBody): string {
  const now = new Date(body.now);
  const tz = body.timeZone || "UTC";
  const human = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(now);
  const digest = buildAssistantDigest(
    body.items.map((item) => ({ ...item, categoryId: item.categoryId ?? "", createdAt: body.now })),
    body.categories,
    body.now,
    tz,
    body.weekStartsOn === 1 ? 1 : 0,
  );
  const categoryNames = new Map(body.categories.map((category) => [category.id, category.name]));
  const line = (item: ReqBody["items"][number]) =>
    [
      item.id,
      item.type,
      item.status ?? "",
      localStamp(item.at, tz),
      item.endAt ? localStamp(item.endAt, tz) : "",
      item.title.slice(0, 120),
      (item.categoryId && categoryNames.get(item.categoryId)) || "",
      item.location?.slice(0, 60) ?? "",
      // When it was finished: "what did I finish last week" cannot be answered
      // from a due date.
      item.status === "done" && item.completedAt ? `done ${localStamp(item.completedAt, tz)}` : "",
    ].join("|");
  const entry = (e: { title: string; at: string; status?: string }) =>
    `${e.title.slice(0, 80)} @ ${localStamp(e.at, tz)}${e.status && e.status !== "todo" ? ` [${e.status}]` : ""}`;
  const compactDigest = {
    dueToday: digest.dueToday.map(entry),
    dueThisWeek: digest.dueThisWeek
      .filter((e) => !digest.dueToday.some((t) => t.id === e.id))
      .map(entry),
    overdue: digest.overdue.map(entry),
    inProgress: digest.inProgress.map(entry),
    completedLast7Days: digest.completedLast7Days,
    nextEvent: digest.nextEvent ? entry(digest.nextEvent) : undefined,
  };
  const snapshot = body.items.slice(0, SNAPSHOT_ITEMS).map(line).join("\n");
  const syllabi = relevantSyllabi(body);
  const hidden = body.items.length - SNAPSHOT_ITEMS;

  return `You are Datebook's calendar and todo assistant. It is ${human}; current instant ${body.now}; user timezone ${tz}. Use a ${body.clock24h ? "24-hour" : "12-hour"} clock.

Calendar categories (classes, id:name): ${body.categories.map((c) => `${c.id}:${c.name}`).join(", ")}
Authoritative digest (local times): ${JSON.stringify(compactDigest)}
Dates (copy the weekday and date from here and from the snapshot; never work them out yourself): ${dateLookupLine(body.now, tz)}
Calendar snapshot, one item per line as id|type|status|start (local, with weekday)|end|title|class|location|completed (done items only), open work and soonest first${hidden > 0 ? `; ${hidden} more not shown, use list_events/list_tasks for them` : ""}:
${snapshot}

${
  syllabi
    ? `${syllabi}

`
    : ""
}Answer questions precisely from the user's data. Completed work is never overdue or still due. Events are not assignments. Never invent an item. For anything not in the snapshot, call list_events or list_tasks. Every data-changing request must call the matching add/update/delete tool (several tool calls in one turn are fine for multi-item requests); do not claim it is complete because all mutations wait for the user's confirmation card. If a target is ambiguous, ask one concise question instead of calling a mutation tool. For multiline pasted schedules, blank lines separate entries and a Location line belongs to the event directly above it. Preserve every title, date, time, location, and reminder the user gave. Resolve relative dates against the Dates line above and the timezone above, and always quote a weekday together with its date exactly as the Dates line or the snapshot shows it. For any question of the form "am I free", "can I fit", "do I have a conflict" or "is anything on", call check_availability with the exact window and trust its answer: free is a boolean computed in code, so never override it from the snapshot. Use ISO 8601 with an explicit offset in tool arguments.

Keep the final response short and natural: 1-3 sentences or a compact bullet list, no heading or table. Use bold only for useful titles, dates, times, or counts. Never expose provider internals or tool JSON.`;
}
