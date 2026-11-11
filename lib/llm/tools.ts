import { z } from "zod";
import type { AssistantReqBody, SlimItem } from "@/lib/assistant-actions";
import { nanoid } from "@/lib/nanoid";
import type { OpenAiTool } from "./openai-compatible";
import { assistantDatabase } from "./database";
import { actionFor } from "@/lib/assistant-tool-actions";
import { checkAvailability, type AvailabilityItem } from "@/lib/availability";

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

const schemas = {
  list_events: z.object({
    start: iso.optional(),
    end: iso.optional(),
    query: z.string().trim().max(200).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  add_event: z.object({
    title: z.string().trim().min(1).max(240),
    start: iso,
    end: iso.optional(),
    allDay: z.boolean().optional(),
    location: optionalText,
    description: optionalText,
    categoryId: id.optional(),
    reminders,
  }),
  update_event: z.object({
    id,
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
    due: iso,
    status: z.enum(["todo", "doing", "done"]).default("todo"),
    itemType: z.enum(["assignment", "task"]).default("task"),
    description: optionalText,
    categoryId: id.optional(),
    reminders,
  }),
  update_task: z.object({
    id,
    title: z.string().trim().min(1).max(240).optional(),
    due: iso.optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    description: z.string().trim().max(8_000).nullable().optional(),
    categoryId: id.optional(),
    reminders,
  }),
  delete_task: z.object({ id }),
  check_availability: z.object({ start: iso, end: iso }),
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
      description: "Propose adding one calendar event. The user must confirm before it is written.",
      parameters: object(
        {
          title: str("Event title"),
          start: dateTime("Start with timezone offset"),
          end: dateTime("Optional end"),
          allDay: { type: "boolean" },
          location: str("Optional location"),
          description: str("Optional notes"),
          categoryId: str("Optional class/category id"),
          reminders: reminderSchema,
        },
        ["title", "start"],
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
          title: str("New title"),
          start: dateTime("New start"),
          end: { type: ["string", "null"], format: "date-time" },
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
          due: dateTime("Due date/time with timezone offset"),
          itemType: { type: "string", enum: ["assignment", "task"] },
          status: { type: "string", enum: ["todo", "doing", "done"] },
          description: str("Optional notes"),
          categoryId: str("Optional class/category id"),
          reminders: reminderSchema,
        },
        ["title", "due"],
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
          title: str("New title"),
          due: dateTime("New due date/time"),
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
    .filter((item) => +new Date(item.at) >= start && +new Date(item.at) <= end)
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
async function availability(ctx: ToolContext, args: Record<string, unknown>) {
  const start = String(args.start);
  const end = String(args.end);
  const timeZone = ctx.body.timeZone || "UTC";
  const db = assistantDatabase();
  let items: AvailabilityItem[];
  if (!ctx.userId || !db) {
    items = fallbackItems(ctx, "event");
  } else {
    // Reach a day back: an event that began earlier can still be running.
    const from = new Date(+new Date(start) - 24 * 60 * 60_000).toISOString();
    const { data, error } = await db
      .from("items")
      .select("id,title,type,at,end_at,all_day")
      .eq("user_id", ctx.userId)
      .eq("type", "event")
      .gte("at", from)
      .lte("at", end)
      .limit(200);
    if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
    items = (data ?? []).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      type: "event",
      at: String(row.at),
      endAt: (row.end_at as string | null) ?? null,
      allDay: Boolean(row.all_day),
    }));
  }
  return checkAvailability(items, start, end, timeZone);
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
  if (tool === "check_availability") return { output: await availability(ctx, args) };
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
  if (tool === "list_tasks") return { output: await listFromDatabase(ctx, "task", args) };
  if (!MUTATIONS.has(tool)) throw new MalformedToolArgumentsError(name, "unsupported tool");

  const target =
    tool.startsWith("update_") || tool.startsWith("delete_")
      ? await ownedItem(ctx, String(args.id))
      : null;
  if ((tool.startsWith("update_") || tool.startsWith("delete_")) && !target) {
    return { output: { ok: false, error: "Item not found for this user" } };
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
