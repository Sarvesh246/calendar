import type { SlimItem } from "@/lib/assistant-actions";

/**
 * Turns a validated tool call into the raw action the client understands.
 * Pure and dependency-free so the server (staging a card) and the client
 * (applying a confirmation) build exactly the same thing from the same
 * arguments — they cannot drift.
 */

export type MutationToolName =
  "add_event" | "update_event" | "delete_event" | "add_task" | "update_task" | "delete_task";

export function actionFor(
  tool: MutationToolName,
  args: Record<string, unknown>,
  target?: Record<string, unknown> | SlimItem | null,
) {
  const title = String(args.title || target?.title || (tool.includes("event") ? "Event" : "Task"));
  if (tool === "add_event") {
    return {
      kind: "create",
      summary: `Add event “${title}”`,
      title,
      itemType: "event",
      at: args.start,
      endAt: args.end,
      allDay: args.allDay,
      location: args.location,
      description: args.description,
      categoryId: args.categoryId,
      reminders: args.reminders,
    };
  }
  if (tool === "add_task") {
    return {
      kind: "create",
      summary: `Add ${args.itemType === "assignment" ? "assignment" : "task"} “${title}”`,
      title,
      itemType: args.itemType,
      at: args.due,
      status: args.status,
      description: args.description,
      categoryId: args.categoryId,
      reminders: args.reminders,
    };
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
    ...(event && "end" in args
      ? args.end === null
        ? { clearEndAt: true }
        : { endAt: args.end }
      : {}),
    ...("location" in args
      ? args.location === null
        ? { clearLocation: true }
        : { location: args.location }
      : {}),
    ...("description" in args
      ? args.description === null
        ? { clearDescription: true }
        : { description: args.description }
      : {}),
    ...(args.categoryId ? { categoryId: args.categoryId } : {}),
    ...(args.status ? { status: args.status } : {}),
    ...(typeof args.allDay === "boolean" ? { allDay: args.allDay } : {}),
    ...(args.reminders ? { reminders: args.reminders } : {}),
  };
}
