import { z } from "zod";
import type { AssistantReqBody, SlimItem } from "@/lib/assistant-actions";
import { nanoid } from "@/lib/nanoid";
import type { OpenAiTool } from "./openai-compatible";
import { assistantDatabase } from "./database";

const id = z.string().min(1).max(100);
const optionalText = z.string().trim().min(1).max(2_000).optional();
const iso = z.string().datetime({ offset: true });
const reminders = z.array(z.object({ offsetMinutes: z.number().int().min(1).max(20_160), label: z.string().trim().max(120).optional() })).max(4).optional();

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
const reminderSchema = { type: "array", maxItems: 4, items: object({ offsetMinutes: { type: "integer", minimum: 1, maximum: 20_160 }, label: str("Optional reminder label") }, ["offsetMinutes"]) };

export const DATEBOOK_TOOLS: OpenAiTool[] = [
  {
    type: "function",
    function: {
      name: "list_events",
      description: "List the signed-in user's calendar events in an optional time range.",
      parameters: object({ start: dateTime("Inclusive start"), end: dateTime("Inclusive end"), query: str("Optional title search"), limit: { type: "integer", minimum: 1, maximum: 100 } }),
    },
  },
  {
    type: "function",
    function: {
      name: "add_event",
      description: "Propose adding one calendar event. The user must confirm before it is written.",
      parameters: object({ title: str("Event title"), start: dateTime("Start with timezone offset"), end: dateTime("Optional end"), allDay: { type: "boolean" }, location: str("Optional location"), description: str("Optional notes"), categoryId: str("Optional class/category id"), reminders: reminderSchema }, ["title", "start"]),
    },
  },
  {
    type: "function",
    function: {
      name: "update_event",
      description: "Propose updating one existing event by its id. The user must confirm.",
      parameters: object({ id: str("Event id from list_events"), title: str("New title"), start: dateTime("New start"), end: { type: ["string", "null"], format: "date-time" }, allDay: { type: "boolean" }, location: { type: ["string", "null"] }, description: { type: ["string", "null"] }, categoryId: str("New category id"), reminders: reminderSchema }, ["id"]),
    },
  },
  {
    type: "function",
    function: { name: "delete_event", description: "Propose deleting one event. Explicit user confirmation is always required.", parameters: object({ id: str("Event id from list_events") }, ["id"]) },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "List the signed-in user's tasks and assignments.",
      parameters: object({ status: { type: "string", enum: ["todo", "doing", "done"] }, dueAfter: dateTime("Inclusive due-date lower bound"), dueBefore: dateTime("Inclusive due-date upper bound"), query: str("Optional title search"), limit: { type: "integer", minimum: 1, maximum: 100 } }),
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description: "Propose adding one task or assignment. The user must confirm before it is written.",
      parameters: object({ title: str("Task title"), due: dateTime("Due date/time with timezone offset"), itemType: { type: "string", enum: ["assignment", "task"] }, status: { type: "string", enum: ["todo", "doing", "done"] }, description: str("Optional notes"), categoryId: str("Optional class/category id"), reminders: reminderSchema }, ["title", "due"]),
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Propose updating one task or assignment by id. The user must confirm.",
      parameters: object({ id: str("Task id from list_tasks"), title: str("New title"), due: dateTime("New due date/time"), status: { type: "string", enum: ["todo", "doing", "done"] }, description: { type: ["string", "null"] }, categoryId: str("New category id"), reminders: reminderSchema }, ["id"]),
    },
  },
  {
    type: "function",
    function: { name: "delete_task", description: "Propose deleting one task or assignment. Explicit user confirmation is always required.", parameters: object({ id: str("Task id from list_tasks") }, ["id"]) },
  },
];

export class MalformedToolArgumentsError extends Error {
  constructor(readonly toolName: string, readonly details: string) {
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
  return ctx.body.items.filter((item) => (type === "event" ? item.type === "event" : item.type !== "event"));
}

function filterFallback(items: SlimItem[], args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query.toLowerCase() : "";
  const start = typeof args.start === "string" ? +new Date(args.start) : typeof args.dueAfter === "string" ? +new Date(args.dueAfter) : -Infinity;
  const end = typeof args.end === "string" ? +new Date(args.end) : typeof args.dueBefore === "string" ? +new Date(args.dueBefore) : Infinity;
  const limit = typeof args.limit === "number" ? args.limit : 50;
  return items
    .filter((item) => +new Date(item.at) >= start && +new Date(item.at) <= end)
    .filter((item) => !query || item.title.toLowerCase().includes(query))
    .filter((item) => !args.status || item.status === args.status)
    .slice(0, limit);
}

async function listFromDatabase(ctx: ToolContext, kind: "event" | "task", args: Record<string, unknown>) {
  const db = assistantDatabase();
  if (!ctx.userId || !db) return filterFallback(fallbackItems(ctx, kind), args);
  let query = db
    .from("items")
    .select("id,title,type,at,end_at,all_day,status,category_id,location,description,url")
    .eq("user_id", ctx.userId)
    .order("at", { ascending: true })
    .limit(typeof args.limit === "number" ? args.limit : 50);
  query = kind === "event" ? query.eq("type", "event") : query.in("type", ["assignment", "task"]);
  if (typeof args.start === "string") query = query.gte("at", args.start);
  if (typeof args.end === "string") query = query.lte("at", args.end);
  if (typeof args.dueAfter === "string") query = query.gte("at", args.dueAfter);
  if (typeof args.dueBefore === "string") query = query.lte("at", args.dueBefore);
  if (typeof args.status === "string") query = query.eq("status", args.status);
  if (typeof args.query === "string" && args.query) query = query.ilike("title", `%${args.query.replace(/[%_,]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw new Error(`Calendar lookup failed: ${error.message}`);
  return data ?? [];
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

function actionFor(tool: DatebookToolName, args: Record<string, unknown>, target?: Record<string, unknown> | SlimItem | null) {
  const title = String(args.title || target?.title || (tool.includes("event") ? "Event" : "Task"));
  if (tool === "add_event") {
    return { kind: "create", summary: `Add event “${title}”`, title, itemType: "event", at: args.start, endAt: args.end, allDay: args.allDay, location: args.location, description: args.description, categoryId: args.categoryId, reminders: args.reminders };
  }
  if (tool === "add_task") {
    return { kind: "create", summary: `Add ${args.itemType === "assignment" ? "assignment" : "task"} “${title}”`, title, itemType: args.itemType, at: args.due, status: args.status, description: args.description, categoryId: args.categoryId, reminders: args.reminders };
  }
  if (tool === "delete_event" || tool === "delete_task") {
    return { kind: "delete", summary: `Delete “${title}”`, itemId: args.id, title };
  }
  const event = tool === "update_event";
  return {
    kind: "update",
    summary: `Update “${title}”`,
    itemId: args.id,
    title,
    ...(args.title ? { title: args.title } : {}),
    ...(event && args.start ? { at: args.start } : {}),
    ...(!event && args.due ? { at: args.due } : {}),
    ...(event && "end" in args ? (args.end === null ? { clearEndAt: true } : { endAt: args.end }) : {}),
    ...("location" in args ? (args.location === null ? { clearLocation: true } : { location: args.location }) : {}),
    ...("description" in args ? (args.description === null ? { clearDescription: true } : { description: args.description }) : {}),
    ...(args.categoryId ? { categoryId: args.categoryId } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(typeof args.allDay === "boolean" ? { allDay: args.allDay } : {}),
    ...(args.reminders ? { reminders: args.reminders } : {}),
  };
}

export async function executeDatebookTool(
  name: string,
  rawArguments: string,
  ctx: ToolContext
): Promise<{ output: unknown; action?: Record<string, unknown> }> {
  if (!(name in schemas)) throw new MalformedToolArgumentsError(name, "unknown tool");
  let json: unknown;
  try {
    json = JSON.parse(rawArguments || "{}");
  } catch {
    throw new MalformedToolArgumentsError(name, "arguments were not valid JSON");
  }
  const parsed = schemas[name as DatebookToolName].safeParse(json);
  if (!parsed.success) throw new MalformedToolArgumentsError(name, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  const tool = name as DatebookToolName;
  const args = parsed.data as Record<string, unknown>;
  if ((tool === "add_event" || tool === "add_task") && !args.categoryId && ctx.body.categories[0]?.id) {
    args.categoryId = ctx.body.categories[0].id;
  }
  if (tool === "list_events") return { output: await listFromDatabase(ctx, "event", args) };
  if (tool === "list_tasks") return { output: await listFromDatabase(ctx, "task", args) };
  if (!MUTATIONS.has(tool)) throw new MalformedToolArgumentsError(name, "unsupported tool");

  const target = tool.startsWith("update_") || tool.startsWith("delete_") ? await ownedItem(ctx, String(args.id)) : null;
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
    if (error) throw new Error(`Could not stage assistant action: ${error.message}`);
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

export async function confirmPendingAction(userId: string, confirmationId: string) {
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
  const args = pending.arguments as Record<string, unknown>;
  let categoryId: string | null = null;
  if (typeof args.categoryId === "string") {
    const { data: category, error: categoryError } = await db
      .from("categories")
      .select("id")
      .eq("id", args.categoryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (categoryError) throw new Error(categoryError.message);
    categoryId = category?.id ?? null;
  }
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await db
    .from("assistant_pending_actions")
    .update({ status: "applied", applied_at: claimedAt })
    .eq("id", confirmationId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) throw new Error("This confirmation was already used");
  let item: Record<string, unknown> | null = null;
  try {
    if (tool === "add_event" || tool === "add_task") {
      const event = tool === "add_event";
      const itemId = nanoid();
      let reminderRows = Array.isArray(args.reminders) ? args.reminders : null;
      if (!reminderRows) {
        const { data: settings } = await db
          .from("user_settings")
          .select("default_reminder_preset_ids")
          .eq("user_id", userId)
          .maybeSingle();
        const presetIds = Array.isArray(settings?.default_reminder_preset_ids)
          ? settings.default_reminder_preset_ids.filter((value): value is string => typeof value === "string")
          : [];
        if (presetIds.length) {
          const { data: presets } = await db
            .from("reminder_presets")
            .select("id,label,offset_minutes")
            .eq("user_id", userId)
            .in("id", presetIds);
          reminderRows = (presets ?? []).map((preset) => ({
            label: preset.label,
            offsetMinutes: preset.offset_minutes,
          }));
        }
      }
      const row = {
        id: itemId,
        user_id: userId,
        category_id: categoryId,
        type: event ? "event" : args.itemType ?? "task",
        title: args.title,
        at: event ? args.start : args.due,
        end_at: event ? args.end ?? null : null,
        all_day: event ? Boolean(args.allDay) : false,
        status: event ? null : args.status ?? "todo",
        location: event ? args.location ?? null : null,
        description: args.description ?? null,
        reminders: reminderRows
          ? reminderRows.map((reminder) => ({ ...(reminder as object), id: nanoid(), itemId }))
          : [],
        updated_at: new Date().toISOString(),
      };
      const { data, error: insertError } = await db.from("items").insert(row).select("*").single();
      if (insertError) throw new Error(insertError.message);
      item = data;
    } else if (tool === "update_event" || tool === "update_task") {
      const event = tool === "update_event";
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (args.title) patch.title = args.title;
      if (event && args.start) patch.at = args.start;
      if (!event && args.due) patch.at = args.due;
      if (event && "end" in args) patch.end_at = args.end;
      if (event && "allDay" in args) patch.all_day = args.allDay;
      if (event && "location" in args) patch.location = args.location;
      if ("description" in args) patch.description = args.description;
      if (args.categoryId) patch.category_id = categoryId;
      if (!event && args.status) {
        const statusAt = new Date().toISOString();
        patch.status = args.status;
        patch.status_at = statusAt;
        patch.completed_at = args.status === "done" ? statusAt : null;
      }
      if (Array.isArray(args.reminders)) {
        patch.reminders = args.reminders.map((reminder) => ({
          ...(reminder as object),
          id: nanoid(),
          itemId: String(args.id),
        }));
      }
      const { data, error: updateError } = await db
        .from("items")
        .update(patch)
        .eq("id", args.id)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (updateError) throw new Error(updateError.message);
      item = data;
    } else {
      const { error: deleteError } = await db.from("items").delete().eq("id", args.id).eq("user_id", userId);
      if (deleteError) throw new Error(deleteError.message);
    }
  } catch (error) {
    await db
      .from("assistant_pending_actions")
      .update({ status: "pending", applied_at: null })
      .eq("id", confirmationId)
      .eq("user_id", userId)
      .eq("status", "applied")
      .eq("applied_at", claimedAt);
    throw error;
  }
  return { tool, item, deletedId: tool.startsWith("delete_") ? args.id : undefined };
}
