import { z } from "zod";

export const WATCH_LIMIT = 100;
export const watchOperation = z
  .object({
    id: z.uuid(),
    itemId: z.uuid(),
    action: z.enum([
      "status",
      "reschedule",
      "priority",
      "subtask",
      "create",
      "rename",
      "class",
      "plan",
      "reminder",
    ]),
    value: z.string().max(240),
    changedAt: z.number().int().positive(),
    base: z.number().int().nonnegative(),
    subtaskId: z.string().max(100).optional(),
  })
  .superRefine((op, ctx) => {
    const fail = () =>
      ctx.addIssue({ code: "custom", message: "Invalid action value", path: ["value"] });
    if (op.action === "status" && !["todo", "doing", "done"].includes(op.value)) fail();
    if (op.action === "priority" && !["low", "normal", "high"].includes(op.value)) fail();
    if (op.action === "subtask" && (!op.subtaskId || !["true", "false"].includes(op.value))) fail();
    if (["create", "rename"].includes(op.action) && !op.value.trim()) fail();
    if (op.action === "class" && !z.uuid().safeParse(op.value).success) fail();
    if (op.action === "plan" && !["25", "50"].includes(op.value)) fail();
    if (op.action === "reminder" && !["10", "30", "60", "1440"].includes(op.value)) fail();
    if (op.action === "reschedule" && (!/^\d{10}$/.test(op.value) || Number(op.value) > 2147483647))
      fail();
  });
export const watchBatch = z.object({ changes: z.array(watchOperation).max(30) });

/** Plain text for a tiny display; never send imported HTML to the watch. */
export function watchText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function epoch(value: unknown): number {
  const n = Date.parse(String(value ?? ""));
  return Number.isFinite(n) ? Math.floor(n / 1000) : 0;
}

export function watchItem(row: Record<string, unknown>, classes: Map<string, string>) {
  return {
    id: row.id,
    title: watchText(row.title, 240),
    class: watchText(classes.get(String(row.category_id)), 80),
    categoryId: row.category_id,
    type: row.type,
    at: epoch(row.at),
    end: epoch(row.end_at),
    allDay: Boolean(row.all_day),
    status: row.status ?? "todo",
    statusAt: epoch(row.status_at),
    updatedAt: epoch(row.updated_at),
    description: watchText(row.description, 600),
    location: watchText(row.location, 160),
    priority: row.priority ?? "normal",
    subtasks: Array.isArray(row.subtasks)
      ? row.subtasks.slice(0, 8).map((s) => ({
          id: watchText(s.id, 100),
          title: watchText(s.title, 80),
          done: Boolean(s.done),
        }))
      : [],
  };
}
