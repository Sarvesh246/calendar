import { z } from "zod";
import { isUndatedAt, UNDATED_AT } from "@/lib/undated";
import { wallTimeInZoneToIso } from "@/lib/date-utils";
import type { AssistantReqBody, SlimItem } from "@/lib/assistant-actions";
import { nanoid } from "@/lib/nanoid";
import type { OpenAiTool } from "./openai-compatible";
import { assistantDatabase } from "./database";
import { actionFor } from "@/lib/assistant-tool-actions";
import { findPossibleDuplicate } from "@/lib/duplicates";
import { checkAvailability, findFreeTime, type AvailabilityItem } from "@/lib/availability";

const id = z.string().min(1).max(100);
const optionalText = z.string().trim().min(1).max(2_000).optional();
const iso = z.string().datetime({ offset: true });
const reminders = z
  .array(
    z.object({
      offsetMinutes: z.number().int().min(1).max(20_160),
      label: z.string().trim().max(120).optional(),
    }),
  )
  .max(4)
  .optional();

/** A repeating add must say when it ends: a series with no end is hundreds of items. */
const repeat = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    byDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    until: iso.optional(),
    untilDate: z.iso.date().optional(),
  })
  .refine((v) => !!v.until || !!v.untilDate, "A series end date is required")
  .optional();

const schemas = {
  select_items: z
    .object({
      categoryId: id.optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
      itemType: z.enum(["event", "assignment", "task"]).optional(),
      after: iso.optional(),
      before: iso.optional(),
      repeatId: id.optional(),
    })
    .refine((v) => Object.keys(v).length > 0, "At least one filter is required"),
  bulk_shift: z.object({
    ids: z.array(id).min(1).max(50),
    minutes: z
      .number()
      .int()
      .min(-525600)
      .max(525600)
      .refine((n) => n !== 0),
  }),
  bulk_delete: z.object({ ids: z.array(id).min(1).max(50) }),
  bulk_update: z
    .object({
      ids: z.array(id).min(1).max(50),
      title: z.string().trim().min(1).max(240).optional(),
      location: z.string().trim().max(2000).nullable().optional(),
      categoryId: id.optional(),
      status: z.enum(["todo", "doing", "done"]).optional(),
    })
    .refine((v) => Object.keys(v).length > 1, "A change is required"),
  revise_pending: z.object({
    ref: z.string().regex(/^\d+:\d+$/),
    title: z.string().trim().min(1).max(240).optional(),
    startDate: z.iso.date().optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endDate: z.iso.date().optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    location: z.string().trim().max(2000).nullable().optional(),
  }),
  list_events: z.object({
    start: iso.optional(),
    end: iso.optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  add_event: z.object({
    title: z.string().trim().min(1).max(240),
    start: iso.optional(),
    end: iso.optional(),
    startDate: z.iso.date().optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endDate: z.iso.date().optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    allDay: z.boolean().optional(),
    location: optionalText,
    description: optionalText,
    categoryId: id.optional(),
    reminders,
    repeat,
    allowDuplicate: z.boolean().optional(),
    workFor: id.optional(),
  }),
  update_event: z.object({
    id,
    repeatDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    repeatUntil: iso.optional(),
    startDate: z.iso.date().optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    endDate: z.iso.date().optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    itemType: z.enum(["event", "assignment", "task"]).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    start: iso.optional(),
    end: iso.nullable().optional(),
    allDay: z.boolean().optional(),
    location: z.string().trim().max(2_000).nullable().optional(),
    description: z.string().trim().max(8_000).nullable().optional(),
    categoryId: id.optional(),
    reminders,
  }),
  delete_event: z.object({ id }),
  list_tasks: z.object({
    status: z.enum(["todo", "doing", "done"]).optional(),
    dueAfter: iso.optional(),
    dueBefore: iso.optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  add_task: z.object({
    title: z.string().trim().min(1).max(240),
    due: iso.optional(),
    undated: z.boolean().optional(),
    dueDate: z.iso.date().optional(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    status: z.enum(["todo", "doing", "done"]).default("todo"),
    itemType: z.enum(["assignment", "task"]).default("task"),
    description: optionalText,
    categoryId: id.optional(),
    reminders,
    allowDuplicate: z.boolean().optional(),
  }),
  update_task: z.object({
    id,
    repeatDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    repeatUntil: iso.optional(),
    undated: z.boolean().optional(),
    dueDate: z.iso.date().optional(),
    dueTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    itemType: z.enum(["event", "assignment", "task"]).optional(),
    title: z.string().trim().min(1).max(240).optional(),
    due: iso.optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    description: z.string().trim().max(8_000).nullable().optional(),
    categoryId: id.optional(),
    reminders,
  }),
  delete_task: z.object({ id }),
  check_availability: z.object({ start: iso, end: iso }),
  find_free_time: z.object({
    start: iso,
    end: iso,
    durationMinutes: z.number().int().min(1).max(1440),
  }),
  show_items: z.object({
    ids: z.array(id).min(1).max(25),
    heading: z.string().trim().min(1).max(80).optional(),
  }),
  offer_choices: z.object({
    options: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
  }),
} as const;

export type DatebookToolName = keyof typeof schemas;
const MUTATIONS = new Set<DatebookToolName>([
  "add_event",
  "update_event",
  "delete_event",
  "add_task",
  "update_task",
  "delete_task",
]);

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const dateTime = (description: string) => ({ type: "string", format: "date-time", description });
const reminderSchema = {
  type: "array",
  maxItems: 4,
  items: object(
    {
      offsetMinutes: { type: "integer", minimum: 1, maximum: 20_160 },
      label: str("Optional reminder label"),
    },
    ["offsetMinutes"],
  ),
};

export const DATEBOOK_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "bulk_update",
      description:
        "Propose a common title, location, class or status change to all resolved ids, including a repeat series. Each item is confirmed individually.",
      parameters: object(
        {
          ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } },
          title: str("New title"),
          location: { type: ["string", "null"] },
          categoryId: str("Class id"),
          status: { type: "string", enum: ["todo", "doing", "done"] },
        },
        ["ids"],
      ),
    },
  },

  {
    type: "function",
    function: {
      name: "select_items",
      description:
        "Resolve all matching item ids for a bulk action or a repeat series. Supply at least one filter. If more than 50 match, ask the user to narrow the request.",
      parameters: object({
        categoryId: str("Class id"),
        status: { type: "string", enum: ["todo", "doing", "done"] },
        itemType: { type: "string", enum: ["event", "assignment", "task"] },
        after: dateTime("Inclusive start"),
        before: dateTime("Inclusive end"),
        repeatId: str("Series id from snapshot"),
      }),
    },
  },

  {
    type: "function",
    function: {
      name: "bulk_shift",
      description:
        "Propose shifting explicitly identified items by the same number of minutes. Resolve every id first. Each change has its own confirmation card; do not use for moving deadlines when planning work sessions.",
      parameters: object(
        {
          ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } },
          minutes: { type: "integer", description: "Signed number of minutes" },
        },
        ["ids", "minutes"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "bulk_delete",
      description:
        "Propose deleting explicitly identified items. Resolve every id first. Each deletion has its own confirmation card.",
      parameters: object(
        { ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } } },
        ["ids"],
      ),
    },
  },

  {
    type: "function",
    function: {
      name: "show_items",
      description:
        "Show the user's own items as tappable rows the app formats itself (title, class, time, status). Use it whenever the answer is a list of two or more items, passing their ids from the snapshot or list_*; then reply with ONE short framing sentence and do not list the items yourself.",
      parameters: object(
        {
          ids: { type: "array", minItems: 1, maxItems: 25, items: { type: "string" } },
          heading: str("Optional short heading, e.g. 'Due this week'"),
        },
        ["ids"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "offer_choices",
      description:
        "When a request is ambiguous, offer 2-4 short answers as tappable choices instead of making the user retype. Ask the question in your reply text, e.g. 'Which one?'.",
      parameters: object(
        { options: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } } },
        ["options"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "revise_pending",
      description:
        "Revise one pending create card by its ref. Supply only the changed fields; this replaces the old card and never changes the calendar before confirmation.",
      parameters: object(
        {
          ref: str("Pending card ref"),
          title: str("Replacement title"),
          startDate: str("New start date YYYY-MM-DD"),
          startTime: str("New start time HH:mm"),
          endDate: str("New inclusive end date YYYY-MM-DD"),
          endTime: str("New end time HH:mm"),
          location: { type: ["string", "null"] },
        },
        ["ref"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "find_free_time",
      description:
        "Find up to five available non-overlapping slots within a requested window. Ask for a window and duration if missing.",
      parameters: object(
        {
          start: dateTime("Window start with timezone offset"),
          end: dateTime("Window end with timezone offset"),
          durationMinutes: { type: "integer", minimum: 1, maximum: 1440 },
        },
        ["start", "end", "durationMinutes"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Answer whether the user is free in a window, computed in code. Use it for every 'am I free', 'can I fit', 'any conflicts' question. Returns {free, conflicts, allDay}; trust it over the snapshot. For a single moment pass the same instant as start and end.",
      parameters: object(
        {
          start: dateTime("Window start with timezone offset"),
          end: dateTime("Window end with timezone offset (equal to start for a moment)"),
        },
        ["start", "end"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "list_events",
      description: "List the signed-in user's calendar events in an optional time range.",
      parameters: object({
        start: dateTime("Inclusive start"),
        end: dateTime("Inclusive end"),
        query: str("Optional title search"),
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "add_event",
      description:
        "Propose adding one calendar event. The user must confirm before it is written. For 'every Monday' style requests pass repeat {freq, byDay, until} on ONE call rather than many events; if the user gave no end date, ask 'until when?' instead of calling. If the tool reports possibleDuplicate, ask the user before adding a copy.",
      parameters: object(
        {
          title: str("Event title"),
          workFor: str(
            "For a work session, the id of the existing task or assignment it supports; this does not move its deadline",
          ),
          startDate: str("Start date YYYY-MM-DD in the user's timezone"),
          startTime: str("Start time HH:mm, omitted for all-day"),
          endDate: str("Last calendar date YYYY-MM-DD, inclusive, for a multi-day event"),
          endTime: str("End time HH:mm for a timed event"),
          allDay: { type: "boolean" },
          location: str("Optional location"),
          description: str("Optional notes"),
          categoryId: str("Optional class/category id"),
          reminders: reminderSchema,
          repeat: object(
            {
              freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
              byDay: {
                type: "array",
                items: { type: "integer", minimum: 0, maximum: 6 },
                description: "Weekly only: 0=Sunday ... 6=Saturday",
              },
              untilDate: str("Last day of the series, YYYY-MM-DD in the user timezone. Required."),
            },
            ["freq", "untilDate"],
          ),
          allowDuplicate: {
            type: "boolean",
            description: "Only after the user confirmed they want a second copy",
          },
        },
        ["title", "startDate"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description: "Propose updating one existing event by its id. The user must confirm.",
      parameters: object(
        {
          id: str("Event id from list_events"),
          itemType: {
            type: "string",
            enum: ["event", "assignment", "task"],
            description: "Only when the user explicitly requests a type conversion",
          },
          title: str("New title"),
          startDate: str("New local start date YYYY-MM-DD"),
          startTime: str("New local start time HH:mm"),
          endDate: str("New inclusive local end date YYYY-MM-DD"),
          endTime: str("New local end time HH:mm"),
          end: {
            type: ["string", "null"],
            format: "date-time",
            description: "Set null to remove an end",
          },
          allDay: { type: "boolean" },
          location: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          categoryId: str("New category id"),
          reminders: reminderSchema,
        },
        ["id"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "delete_event",
      description: "Propose deleting one event. Explicit user confirmation is always required.",
      parameters: object({ id: str("Event id from list_events") }, ["id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List the signed-in user's tasks and assignments.",
      parameters: object({
        status: { type: "string", enum: ["todo", "doing", "done"] },
        dueAfter: dateTime("Inclusive due-date lower bound"),
        dueBefore: dateTime("Inclusive due-date upper bound"),
        query: str("Optional title search"),
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Propose adding one task or assignment. The user must confirm before it is written.",
      parameters: object(
        {
          title: str("Task title"),
          undated: {
            type: "boolean",
            description: "True only when the user explicitly wants no due date",
          },
          dueDate: str("Due date YYYY-MM-DD in the user timezone"),
          dueTime: str("Due time HH:mm; omit for end of day"),
          itemType: { type: "string", enum: ["assignment", "task"] },
          status: { type: "string", enum: ["todo", "doing", "done"] },
          description: str("Optional notes"),
          categoryId: str("Optional class/category id"),
          reminders: reminderSchema,
          allowDuplicate: {
            type: "boolean",
            description: "Only after the user confirmed they want a second copy",
          },
        },
        ["title"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Propose updating one task or assignment by id. The user must confirm.",
      parameters: object(
        {
          id: str("Task id from list_tasks"),
          undated: {
            type: "boolean",
            description: "Set true only to remove the due date and time reminders",
          },
          itemType: {
            type: "string",
            enum: ["event", "assignment", "task"],
            description: "Only when the user explicitly requests a type conversion",
          },
          title: str("New title"),
          dueDate: str("New local due date YYYY-MM-DD"),
          dueTime: str("New local due time HH:mm"),
          status: { type: "string", enum: ["todo", "doing", "done"] },
          description: { type: ["string", "null"] },
          categoryId: str("New category id"),
          reminders: reminderSchema,
        },
        ["id"],
      ),
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description:
        "Propose deleting one task or assignment. Explicit user confirmation is always required.",
      parameters: object({ id: str("Task id from list_tasks") }, ["id"]),
    },
  },
];

export class MalformedToolArgumentsError extends Error {
  constructor(
    readonly toolName: string,
    readonly details: string,
  ) {
    super(`Malformed ${toolName} arguments: ${details}`);
    this.name = "MalformedToolArgumentsError";
  }
}

function checkedWallTime(name: string, day: string, time: string, zone: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const iso = wallTimeInZoneToIso(day, hour, minute, zone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  if (
    `${get("year")}-${get("month")}-${get("day")}` !== day ||
    `${get("hour")}:${get("minute")}` !== time
  )
    throw new MalformedToolArgumentsError(name, "Invalid or nonexistent local date/time");
  return iso;
}

type ToolContext = {
  userId: string | null;
  threadId: string | null;
  body: AssistantReqBody;
};

function fallbackItems(ctx: ToolContext, type: "event" | "task") {
  return ctx.body.items.filter((item) =>
    type === "event" ? item.type === "event" : item.type !== "event",
  );
}

function filterFallback(items: SlimItem[], args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
  const start =
    typeof args.start === "string"
      ? +new Date(args.start)
      : typeof args.dueAfter === "string"
        ? +new Date(args.dueAfter)
        : -Infinity;
  const end =
    typeof args.end === "string"
      ? +new Date(args.end)
      : typeof args.dueBefore === "string"
        ? +new Date(args.dueBefore)
        : Infinity;
  const limit = typeof args.limit === "number" ? args.limit : 50;
  return items
    .filter(
      (item) =>
        (!(args.dueAfter || args.dueBefore) || item.at !== UNDATED_AT) &&
        +new Date(item.at) >= start &&
        +new Date(item.at) <= end,
    )
    .filter((item) => !query || item.title.toLowerCase().includes(query))
    .filter((item) => !args.status || item.status === args.status)
    .slice(0, limit);
}

async function listFromDatabase(
  ctx: ToolContext,
  kind: "event" | "task",
  args: Record<string, unknown>,
) {
  const db = assistantDatabase();
  if (!ctx.userId || !db) return filterFallback(fallbackItems(ctx, kind), args);
  let query = db
    .from("items")
    .select(
      "id,title,type,at,end_at,all_day,status,completed_at,category_id,location,description,url",
    )
    .eq("user_id", ctx.userId)
    .order("at", { ascending: true })
    .limit(typeof args.limit === "number" ? args.limit : 50);
  query = kind === "event" ? query.eq("type", "event") : query.in("type", ["assignment", "task"]);
  if (typeof args.start === "string") query = query.gte("at", args.start);
  if (typeof args.end === "string") query = query.lte("at", args.end);
  if (args.dueAfter || args.dueBefore) query = query.neq("at", UNDATED_AT);
  if (typeof args.dueAfter === "string") query = query.gte("at", args.dueAfter);
  if (typeof args.dueBefore === "string") query = query.lte("at", args.dueBefore);
  if (typeof args.status === "string") query = query.eq("status", args.status);
  if (typeof args.query === "string" && args.query)
    query = query.ilike("title", `%${args.query.replace(/[%_,]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
  return data ?? [];
}

/** `check_availability`: events from the database (or the request's snapshot),
 *  judged by the same pure function the tests pin. */
async function availabilityItems(ctx: ToolContext, args: Record<string, unknown>) {
  const start = String(args.start);
  const end = String(args.end);
  const db = assistantDatabase();
  let items: AvailabilityItem[];
  if (!ctx.userId || !db) {
    if (typeof ctx.body.itemCount === "number" && ctx.body.itemCount > ctx.body.items.length)
      throw new Error("The complete calendar is unavailable for an availability check");
    items = fallbackItems(ctx, "event");
  } else {
    // Reach a day back: an event that began earlier can still be running.
    const from = new Date(+new Date(start) - 24 * 60 * 60_000).toISOString();
    const { data, error } = await db
      .from("items")
      .select("id,title,type,at,end_at,all_day")
      .eq("user_id", ctx.userId)
      .eq("type", "event")
      .lte("at", end)
      .or(`end_at.gte.${start},and(end_at.is.null,at.gte.${from})`)
      .limit(2000);
    if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
    if ((data?.length ?? 0) >= 2000)
      throw new Error("Availability window has too many events to evaluate safely");
    items = (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      type: "event",
      at: String(row.at),
      endAt: (row.end_at as string | null) ?? null,
      allDay: Boolean(row.all_day),
    }));
  }
  return items;
}

/** Only ids that are really this user's: the snapshot, then the database. */
async function knownItemIds(ctx: ToolContext, ids: string[]): Promise<string[]> {
  const inSnapshot = new Set(ctx.body.items.map((item) => item.id));
  const unknown = ids.filter((id) => !inSnapshot.has(id));
  const db = assistantDatabase();
  let found = new Set<string>();
  if (unknown.length && ctx.userId && db) {
    const { data } = await db
      .from("items")
      .select("id")
      .eq("user_id", ctx.userId)
      .in("id", unknown);
    found = new Set((data ?? []).map((row) => String(row.id)));
  }
  return [...new Set(ids)].filter((id) => inSnapshot.has(id) || found.has(id));
}

function findFallback(ctx: ToolContext, itemId: string) {
  return ctx.body.items.find((item) => item.id === itemId);
}

async function ownedItem(ctx: ToolContext, itemId: string) {
  const db = assistantDatabase();
  if (!ctx.userId || !db) return findFallback(ctx, itemId);
  const { data, error } = await db
    .from("items")
    .select("id,title,type,at,end_at,all_day,status,category_id,location,description")
    .eq("user_id", ctx.userId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
  return data;
}

export async function executeDatebookTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<{
  output: unknown;
  action?: Record<string, unknown>;
  actions?: Record<string, unknown>[];
  display?: { items?: { ids: string[]; heading?: string }; choices?: string[] };
}> {
  if (!(name in schemas)) throw new MalformedToolArgumentsError(name, "unknown tool");
  let json: unknown;
  try {
    json = JSON.parse(rawArguments || "{}");
  } catch {
    throw new MalformedToolArgumentsError(name, "arguments were not valid JSON");
  }
  const parsed = schemas[name as DatebookToolName].safeParse(json);
  if (!parsed.success)
    throw new MalformedToolArgumentsError(
      name,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  const tool = name as DatebookToolName;
  const args = parsed.data as Record<string, unknown>;
  if (tool === "add_event") {
    const zone = ctx.body.timeZone || "UTC";
    const convert = (day: string, time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      const iso = wallTimeInZoneToIso(day, hour, minute, zone);
      // Reject impossible dates and spring-forward gaps instead of silently moving them.
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(iso));
      const get = (type: string) => parts.find((p) => p.type === type)?.value;
      if (
        `${get("year")}-${get("month")}-${get("day")}` !== day ||
        `${get("hour")}:${get("minute")}` !== time
      )
        throw new MalformedToolArgumentsError(name, "Invalid or nonexistent local date/time");
      return iso;
    };
    if (typeof args.startDate === "string") {
      if (!args.startTime && args.allDay !== true)
        throw new MalformedToolArgumentsError(
          name,
          "Provide startTime, or set allDay only when the user requested an all-day event",
        );
      const allDay = args.allDay === true;
      args.allDay = allDay;
      args.start = convert(args.startDate, allDay ? "00:00" : String(args.startTime));
      if (args.endDate || args.endTime) {
        if (!allDay && args.endDate && !args.endTime)
          throw new MalformedToolArgumentsError(name, "A timed multi-day event needs an end time");
        let endDay = String(args.endDate || args.startDate);
        if (allDay) {
          const d = new Date(`${endDay}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          endDay = d.toISOString().slice(0, 10);
        }
        args.end = convert(endDay, allDay ? "00:00" : String(args.endTime || args.startTime));
      }
    }
    const rule = args.repeat as { until?: string; untilDate?: string } | undefined;
    if (rule?.untilDate) rule.until = convert(rule.untilDate, "23:59");
    if (rule?.until && +new Date(rule.until) < +new Date(String(args.start)))
      throw new MalformedToolArgumentsError(name, "Series end must not precede its start");
    if (typeof args.start !== "string")
      throw new MalformedToolArgumentsError(name, "startDate is required");
    if (typeof args.end === "string" && +new Date(args.end) <= +new Date(args.start))
      throw new MalformedToolArgumentsError(name, "End must be after start");
  }
  if (tool === "add_task") {
    if (args.undated === true) {
      if (
        args.dueDate ||
        args.due ||
        args.dueTime ||
        (Array.isArray(args.reminders) && args.reminders.length)
      )
        throw new MalformedToolArgumentsError(
          name,
          "An undated task cannot have a due date or time reminders",
        );
      args.due = UNDATED_AT;
      args.reminders = [];
    }
    if (typeof args.dueDate === "string") {
      const time = String(args.dueTime || "23:59");
      args.due = checkedWallTime(name, args.dueDate, time, ctx.body.timeZone || "UTC");
    }
    if (typeof args.due !== "string")
      throw new MalformedToolArgumentsError(name, "A due date is required");
  }
  if (tool === "select_items") {
    const db = assistantDatabase();
    let ids: string[];
    if (ctx.userId && db) {
      let query = db.from("items").select("id").eq("user_id", ctx.userId).limit(51);
      if (args.categoryId) query = query.eq("category_id", args.categoryId);
      if (args.status) {
        query = query.in("type", ["task", "assignment"]);
        query =
          args.status === "todo"
            ? query.or("status.eq.todo,status.is.null")
            : query.eq("status", args.status);
      }
      if (args.itemType) query = query.eq("type", args.itemType);
      if (args.after || args.before) query = query.neq("at", UNDATED_AT);
      if (args.after) query = query.gte("at", args.after);
      if (args.before) query = query.lte("at", args.before);
      if (args.repeatId) query = query.eq("repeat_id", args.repeatId);
      const { data, error } = await query;
      if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
      ids = (data ?? []).map((row) => String(row.id));
    } else {
      if (typeof ctx.body.itemCount !== "number" || ctx.body.itemCount > ctx.body.items.length)
        return {
          output: {
            ok: false,
            error: "The complete calendar is unavailable. Narrowing cannot be verified.",
          },
        };
      ids = ctx.body.items
        .filter(
          (item) =>
            (!args.categoryId || item.categoryId === args.categoryId) &&
            (!args.status || (item.type !== "event" && (item.status ?? "todo") === args.status)) &&
            (!args.itemType || item.type === args.itemType) &&
            (!(args.after || args.before) || item.at !== UNDATED_AT) &&
            (!args.after || +new Date(item.at) >= +new Date(String(args.after))) &&
            (!args.before || +new Date(item.at) <= +new Date(String(args.before))) &&
            (!args.repeatId || item.repeatId === args.repeatId),
        )
        .map((item) => item.id);
    }
    if (ids.length > 50)
      return {
        output: {
          ok: false,
          error: "More than 50 items match; ask the user to narrow the request.",
        },
      };
    if (ids.some((itemId) => !ctx.body.items.some((item) => item.id === itemId)))
      return {
        output: {
          ok: false,
          error:
            "Not all matching items are available for confirmation; ask the user to narrow the request.",
        },
      };
    return { output: { ok: true, ids, count: ids.length } };
  }
  if (tool === "bulk_shift" || tool === "bulk_delete" || tool === "bulk_update") {
    const ids = [...new Set(args.ids as string[])];
    // The client must have every target to render and apply its card.
    const targets = ids.map((itemId) => ctx.body.items.find((item) => item.id === itemId));
    if (targets.some((item) => !item))
      return {
        output: {
          ok: false,
          error: "Some items are not available for confirmation. Narrow the request.",
        },
      };
    if (
      tool === "bulk_update" &&
      ((args.status && targets.some((item) => item?.type === "event")) ||
        ("location" in args && targets.some((item) => item?.type !== "event")))
    )
      return {
        output: {
          ok: false,
          error: "That change does not apply to every selected item; narrow the selection.",
        },
      };
    if (
      tool === "bulk_shift" &&
      targets.some((item) => item && item.type !== "event" && isUndatedAt(item.at))
    )
      return {
        output: { ok: false, error: "An undated task cannot be shifted. Set a due date first." },
      };
    if (
      tool === "bulk_shift" &&
      targets.some((item) => item?.allDay && Number(args.minutes) % 1440 !== 0)
    )
      return { output: { ok: false, error: "All-day events must move by whole days." } };
    if (tool === "bulk_shift") {
      for (const repeatId of new Set(
        targets.map((item) => item?.repeatId).filter((value): value is string => Boolean(value)),
      )) {
        const selected = await executeDatebookTool(
          "select_items",
          JSON.stringify({ repeatId }),
          ctx,
        );
        const found = selected.output as { ok?: boolean; ids?: string[] };
        if (!found.ok || found.ids?.some((itemId) => !ids.includes(itemId)))
          return { output: { ok: false, error: "Select the complete series before shifting it." } };
      }
    }
    const owned = await Promise.all(ids.map((itemId) => ownedItem(ctx, itemId)));
    if (owned.some((item) => !item))
      return { output: { ok: false, error: "Some items no longer exist." } };
    const actions: Record<string, unknown>[] = [];
    for (const item of targets) {
      if (!item) continue;
      const event = item.type === "event";
      const operation =
        tool === "bulk_delete"
          ? event
            ? "delete_event"
            : "delete_task"
          : event
            ? "update_event"
            : "update_task";
      const delta = Number(args.minutes || 0) * 60_000;
      const zone = ctx.body.timeZone || "UTC";
      const shift = (value: string) => {
        if (Number(args.minutes) % 1440 !== 0)
          return new Date(+new Date(value) + delta).toISOString();
        const p = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date(value));
        const get = (type: string) => p.find((part) => part.type === type)?.value;
        const day = new Date(`${get("year")}-${get("month")}-${get("day")}T00:00:00Z`);
        day.setUTCDate(day.getUTCDate() + Number(args.minutes) / 1440);
        const date = day.toISOString().slice(0, 10);
        return new Date(
          +new Date(checkedWallTime(name, date, `${get("hour")}:${get("minute")}`, zone)) +
            Number(get("second")) * 1000,
        ).toISOString();
      };
      const repeatPatch: Record<string, unknown> = {};
      if (tool === "bulk_shift" && item.repeatId && item.repeat) {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const before = formatter.format(new Date(item.at));
        const after = formatter.format(new Date(shift(item.at)));
        const dayDelta = Math.round(
          (+new Date(`${after}T00:00:00Z`) - +new Date(`${before}T00:00:00Z`)) / 86_400_000,
        );
        if (dayDelta && Number(args.minutes) % 1440 !== 0)
          return {
            output: { ok: false, error: "A series shift across midnight needs a whole-day move." },
          };
        if (item.repeat.freq === "weekly" && item.repeat.byDay?.length && dayDelta)
          repeatPatch.repeatDays = [
            ...new Set(item.repeat.byDay.map((d) => (d + (dayDelta % 7) + 7) % 7)),
          ].sort();
        if (item.repeat.until && Number(args.minutes) % 1440 === 0)
          repeatPatch.repeatUntil = shift(item.repeat.until);
      }
      const shifted =
        tool === "bulk_update"
          ? {
              ...(args.title ? { title: args.title } : {}),
              ...(event && "location" in args ? { location: args.location } : {}),
              ...(args.categoryId ? { categoryId: args.categoryId } : {}),
              ...(!event && args.status ? { status: args.status } : {}),
            }
          : tool === "bulk_shift"
            ? {
                ...(event
                  ? {
                      start: shift(item.at),
                      ...(item.endAt ? { end: shift(item.endAt) } : {}),
                    }
                  : { due: shift(item.at) }),
              }
            : {};
      const result = await executeDatebookTool(
        operation,
        JSON.stringify({ id: item.id, ...shifted, ...repeatPatch }),
        ctx,
      );
      if (!result.action) return { output: { ok: false, error: "Could not prepare all changes." } };
      actions.push(result.action);
    }
    if (tool === "bulk_shift" && targets.some((item) => item?.repeatId)) {
      const action = { kind: "batch", summary: "Move the complete series", actions };
      return {
        action,
        output: { ok: true, status: "awaiting_confirmation", summary: action.summary },
      };
    }
    return {
      actions,
      output: { ok: true, status: "awaiting_confirmation", count: actions.length },
    };
  }
  if (tool === "revise_pending") {
    const pending = ctx.body.pendingCreates?.find((entry) => entry.ref === args.ref);
    const draft = pending?.draft;
    if (
      !draft ||
      !draft.title ||
      !draft.at ||
      !["event", "task", "assignment"].includes(draft.type) ||
      Number.isNaN(+new Date(draft.at))
    )
      return { output: { ok: false, error: "Pending card no longer available" } };
    const zone = ctx.body.timeZone || "UTC";
    const parts = (iso: string) => {
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(iso));
      const get = (key: string) => p.find((x) => x.type === key)?.value;
      return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        time: `${get("hour")}:${get("minute")}`,
      };
    };
    const convert = (date: string, time: string) => {
      const [h, m] = time.split(":").map(Number);
      const result = wallTimeInZoneToIso(date, h, m, zone);
      const actual = parts(result);
      if (actual.date !== date || actual.time !== time)
        throw new MalformedToolArgumentsError(name, "Invalid or nonexistent local date/time");
      return result;
    };
    const start = parts(draft.at);
    const at =
      args.startDate || args.startTime
        ? convert(
            String(args.startDate || start.date),
            String(args.startTime || (isUndatedAt(draft.at) ? "23:59" : start.time)),
          )
        : draft.at;
    let endAt = draft.endAt;
    if (args.endDate || args.endTime) {
      if (!draft.allDay && args.endDate && !args.endTime && !draft.endAt)
        throw new MalformedToolArgumentsError(name, "A timed multi-day event needs an end time");
      const originalEnd = draft.endAt ? parts(draft.endAt) : start;
      let day = String(args.endDate || originalEnd.date);
      if (draft.allDay && args.endDate) {
        const d = new Date(`${day}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        day = d.toISOString().slice(0, 10);
      }
      endAt = convert(day, draft.allDay ? "00:00" : String(args.endTime || originalEnd.time));
    }
    if (endAt && +new Date(endAt) <= +new Date(at))
      throw new MalformedToolArgumentsError(name, "End must be after start");
    const action = {
      kind: "create",
      summary: `Add “${args.title || draft.title}”`,
      title: args.title || draft.title,
      itemType: draft.type,
      at,
      endAt,
      allDay: draft.allDay,
      location: args.location === null ? undefined : (args.location ?? draft.location),
      description: draft.description,
      categoryId: draft.categoryId,
      status: draft.status,
      reminders: draft.reminders,
      workFor: draft.workFor,
      ...(draft.repeat
        ? {
            repeatFreq: draft.repeat.freq,
            repeatDays: draft.repeat.byDay,
            until: draft.repeat.until,
          }
        : {}),
      revisionOf: pending.ref,
    };
    return {
      action,
      output: { ok: true, status: "awaiting_confirmation", summary: action.summary },
    };
  }
  if (tool === "check_availability" || tool === "find_free_time") {
    const start = String(args.start),
      end = String(args.end);
    if (+new Date(end) < +new Date(start) || +new Date(end) - +new Date(start) > 31 * 86_400_000)
      throw new MalformedToolArgumentsError(name, "Choose a valid window of at most 31 days");
    const events = await availabilityItems(ctx, args);
    return {
      output:
        tool === "check_availability"
          ? checkAvailability(events, start, end, ctx.body.timeZone || "UTC")
          : {
              slots: findFreeTime(
                events,
                start,
                end,
                Number(args.durationMinutes),
                ctx.body.timeZone || "UTC",
              ),
            },
    };
  }
  if (tool === "show_items") {
    const ids = await knownItemIds(ctx, args.ids as string[]);
    if (!ids.length) return { output: { ok: false, error: "None of those ids exist" } };
    return {
      output: { ok: true, shown: ids.length, instruction: "Reply with one short sentence only." },
      display: {
        items: { ids, ...(typeof args.heading === "string" ? { heading: args.heading } : {}) },
      },
    };
  }
  if (tool === "offer_choices") {
    return { output: { ok: true }, display: { choices: args.options as string[] } };
  }
  if (tool === "list_events") return { output: await listFromDatabase(ctx, "event", args) };
  if (tool === "list_tasks") {
    const rows = await listFromDatabase(ctx, "task", args);
    return {
      output: rows.map((row) => (isUndatedAt(row.at) ? { ...row, at: null, undated: true } : row)),
    };
  }
  if (!MUTATIONS.has(tool)) throw new MalformedToolArgumentsError(name, "unsupported tool");

  if (tool === "add_event" && typeof args.workFor === "string") {
    const work = await ownedItem(ctx, args.workFor);
    if (!work || work.type === "event")
      return { output: { ok: false, error: "Work item not found" } };
  }
  if (tool === "add_event" || tool === "add_task") {
    const proposedAt = String(tool === "add_event" ? args.start : args.due);
    const twin = args.allowDuplicate
      ? null
      : findPossibleDuplicate(ctx.body.items, { title: String(args.title), at: proposedAt });
    if (twin) {
      return {
        output: {
          ok: false,
          possibleDuplicate: { id: twin.id, title: twin.title, at: twin.at },
          instruction:
            "Nothing was staged. Ask the user whether they want a second copy; only if they say yes, call again with allowDuplicate true.",
        },
      };
    }
  }

  const target =
    tool.startsWith("update_") || tool.startsWith("delete_")
      ? await ownedItem(ctx, String(args.id))
      : null;
  if ((tool.startsWith("update_") || tool.startsWith("delete_")) && !target) {
    return { output: { ok: false, error: "Item not found for this user" } };
  }
  if (tool === "update_task" && args.undated === true) {
    if (args.due || args.dueDate || args.dueTime || args.itemType === "event")
      throw new MalformedToolArgumentsError(
        name,
        "An undated task cannot have a due date or become an event",
      );
    args.due = UNDATED_AT;
    args.reminders = [];
  }
  if (
    tool === "update_task" &&
    target &&
    args.itemType === "event" &&
    isUndatedAt((target as Record<string, unknown>).at) &&
    !(args.dueDate && args.dueTime) &&
    !args.due
  )
    return {
      output: { ok: false, error: "An event needs a date and time; ask the user for them." },
    };
  if (tool === "update_task" && target && (args.dueDate || args.dueTime)) {
    const zone = ctx.body.timeZone || "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(String((target as Record<string, unknown>).at)));
    const get = (type: string) => parts.find((part) => part.type === type)?.value;
    const day = String(args.dueDate || `${get("year")}-${get("month")}-${get("day")}`);
    const time = String(
      args.dueTime ||
        (isUndatedAt((target as Record<string, unknown>).at)
          ? "23:59"
          : `${get("hour")}:${get("minute")}`),
    );
    args.due = checkedWallTime(name, day, time, zone);
  }
  if (tool === "update_event" && target) {
    const row = target as Record<string, unknown>;
    const zone = ctx.body.timeZone || "UTC";
    const local = (value: string) => {
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(value));
      const get = (type: string) => p.find((part) => part.type === type)?.value;
      return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        time: `${get("hour")}:${get("minute")}`,
      };
    };
    const convert = (day: string, time: string) => {
      const [h, m] = time.split(":").map(Number);
      const value = wallTimeInZoneToIso(day, h, m, zone);
      const actual = local(value);
      if (actual.date !== day || actual.time !== time)
        throw new MalformedToolArgumentsError(name, "Invalid or nonexistent local date/time");
      return value;
    };
    const oldStart = String(row.at);
    const oldEnd = (row.endAt ?? row.end_at) as string | undefined;
    const allDay =
      typeof args.allDay === "boolean" ? args.allDay : Boolean(row.allDay ?? row.all_day);
    const oldLocal = local(oldStart);
    if (args.startDate || args.startTime)
      args.start = convert(
        String(args.startDate || oldLocal.date),
        String(args.startTime || oldLocal.time),
      );
    if (args.endDate || args.endTime) {
      const oldEndLocal = oldEnd ? local(oldEnd) : oldLocal;
      let date = String(args.endDate || oldEndLocal.date);
      if (allDay && args.endDate) {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        date = d.toISOString().slice(0, 10);
      }
      args.end = convert(date, allDay ? "00:00" : String(args.endTime || oldEndLocal.time));
    }
    const start = String(args.start || oldStart);
    const end = args.end === null ? null : String(args.end || oldEnd || "");
    if (end && +new Date(end) <= +new Date(start))
      throw new MalformedToolArgumentsError(name, "End must be after start");
  }
  const action = actionFor(tool, args, target as Record<string, unknown> | SlimItem | null);
  const db = assistantDatabase();
  let confirmationId: string | undefined;
  if (ctx.userId && ctx.threadId && db) {
    confirmationId = nanoid();
    const { error } = await db.from("assistant_pending_actions").insert({
      id: confirmationId,
      user_id: ctx.userId,
      thread_id: ctx.threadId,
      tool_name: tool,
      arguments: args,
      summary: String(action.summary),
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    if (error && /assistant_pending_actions|schema cache/i.test(error.message)) {
      // A newly deployed app may briefly precede its Supabase migration. Keep
      // Datebook's existing local-first confirmation path alive until the
      // table is applied; never turn a missing history table into "AI offline".
      console.warn("[assistant] confirmation table unavailable; using local confirmation");
      confirmationId = undefined;
    } else if (error) {
      throw new Error(`Could not stage assistant action: ${error.message}`);
    }
  }
  return {
    action: confirmationId ? { ...action, serverActionId: confirmationId } : action,
    output: {
      ok: true,
      status: "awaiting_confirmation",
      confirmationId,
      summary: action.summary,
    },
  };
}

/**
 * Confirming a staged action is a validation step, nothing more.
 *
 * It used to write to Postgres itself — hard deletes with no tombstone, a lossy
 * row mapping pushed back into the client with `setState`, no reminder
 * scheduling, no undo, no save pill. The client already owns all of that
 * through `addItem` / `updateItem` / `deleteItem`, so the server now only
 * checks that the confirmation is real, unexpired and unused, that the target
 * still exists and the class belongs to the user, claims it (so it cannot be
 * used twice) and hands the validated arguments back for the client to apply.
 */
export async function confirmPendingAction(
  userId: string,
  confirmationId: string,
): Promise<{ tool: DatebookToolName; arguments: Record<string, unknown> }> {
  const db = assistantDatabase();
  if (!db) throw new Error("Assistant database is not configured");
  const { data: pending, error } = await db
    .from("assistant_pending_actions")
    .select("id,tool_name,arguments,status,expires_at")
    .eq("id", confirmationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pending || pending.status !== "pending" || +new Date(pending.expires_at) < Date.now()) {
    throw new Error("This confirmation is missing, expired, or already used");
  }
  const tool = pending.tool_name as DatebookToolName;
  if (!MUTATIONS.has(tool))
    throw new Error("This confirmation is missing, expired, or already used");
  // Re-validate what was stored: the row is data, not something to trust.
  const checked = schemas[tool].safeParse(pending.arguments);
  if (!checked.success) throw new Error("This confirmation is missing, expired, or already used");
  const args = { ...(checked.data as Record<string, unknown>) };
  if (tool === "add_task" && typeof args.due !== "string")
    throw new Error("This confirmation is missing, expired, or already used");
  if (tool === "add_event" && typeof args.start !== "string")
    throw new Error("This confirmation is missing, expired, or already used");

  if (typeof args.categoryId === "string") {
    const { data: category, error: categoryError } = await db
      .from("categories")
      .select("id")
      .eq("id", args.categoryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (categoryError) throw new Error(categoryError.message);
    // A class that is not this user's is dropped, never applied; the client
    // then files the item the way it files any unclassed add.
    if (!category) delete args.categoryId;
  }

  if (tool.startsWith("update_") || tool.startsWith("delete_")) {
    const { data: target, error: targetError } = await db
      .from("items")
      .select("id")
      .eq("id", String(args.id))
      .eq("user_id", userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("This item no longer exists");
  }

  const { data: claimed, error: claimError } = await db
    .from("assistant_pending_actions")
    .update({ status: "applied", applied_at: new Date().toISOString() })
    .eq("id", confirmationId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error("This confirmation was already used");
  return { tool, arguments: args };
}
