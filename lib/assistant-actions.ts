import type { Item, ItemStatus, ItemType } from "./types";
import { wallTimeInZoneToIso } from "./date-utils";
import { zonedDateKey } from "./ai-assistant";

export interface SlimItem {
  id: string;
  title: string;
  type: ItemType;
  at: string;
  endAt?: string;
  allDay?: boolean;
  status?: ItemStatus;
  categoryId?: string;
  categoryName?: string;
  location?: string;
  description?: string;
  url?: string;
}

export interface AssistantReqBody {
  message: string;
  history?: { role: "user" | "assistant"; text: string }[];
  now: string;
  timeZone?: string;
  clock24h?: boolean;
  weekStartsOn?: 0 | 1;
  items: SlimItem[];
  categories: { id: string; name: string }[];
}

interface RawAction {
  kind?: "create" | "update" | "delete";
  summary?: string;
  itemId?: string;
  title?: string;
  itemType?: ItemType;
  at?: string;
  endAt?: string;
  allDay?: boolean;
  location?: string;
  description?: string;
  categoryId?: string;
  status?: ItemStatus;
  clearEndAt?: boolean;
  clearLocation?: boolean;
  clearDescription?: boolean;
}

export type AssistantAction =
  | { kind: "create"; summary: string; draft: Omit<Item, "id" | "createdAt"> }
  | { kind: "update"; summary: string; itemId: string; itemTitle: string; patch: Partial<Item> }
  | { kind: "delete"; summary: string; itemId: string; itemTitle: string };

export function isPureQuestion(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  const mutation =
    /\b(add|create|schedule|new|set up|book|block off|remind me to|move|reschedule|push|bump|shift|rename|retitle|change|mark|complete|finish|check off|reopen|delete|remove|cancel|clear)\b/;
  if (mutation.test(t)) return false;
  return (
    t.endsWith("?") ||
    /^(what|when|where|which|who|why|how|do i|did i|have i|am i|is there|are there|will i|can you|could you|should i|show me|list|tell me)\b/.test(
      t
    )
  );
}

function validIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(+d) ? undefined : d.toISOString();
}

function defaultAt(type: ItemType, nowIso: string, timeZone = "UTC"): string {
  const key = zonedDateKey(nowIso, timeZone);
  return wallTimeInZoneToIso(key, type === "event" ? 12 : 23, type === "event" ? 0 : 59, timeZone);
}

/** Exact title match only (case-insensitive). Ambiguous or substring hits are ignored. */
export function exactFind(items: SlimItem[], q: string): SlimItem | undefined {
  const needle = q.trim().toLowerCase();
  if (!needle) return undefined;
  const hits = items.filter((i) => i.title.toLowerCase() === needle);
  return hits.length === 1 ? hits[0] : undefined;
}

export function normalizeActions(raw: unknown, body: AssistantReqBody): AssistantAction[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(body.items.map((i) => [i.id, i]));
  const catIds = new Set(body.categories.map((c) => c.id));
  const defaultCat = body.categories[0]?.id ?? "";
  const out: AssistantAction[] = [];

  for (const a of raw as RawAction[]) {
    if (!a || typeof a !== "object") continue;
    const summary = typeof a.summary === "string" && a.summary.trim() ? a.summary.trim() : "";

    if (a.kind === "create") {
      const title = typeof a.title === "string" ? a.title.trim() : "";
      if (!title) continue;
      const type: ItemType =
        a.itemType === "event" || a.itemType === "assignment" || a.itemType === "task"
          ? a.itemType
          : "task";
      const at = validIso(a.at) ?? defaultAt(type, body.now, body.timeZone || "UTC");
      const draft: Omit<Item, "id" | "createdAt"> = {
        title,
        type,
        categoryId: a.categoryId && catIds.has(a.categoryId) ? a.categoryId : defaultCat,
        at,
      };
      const endAt = validIso(a.endAt);
      if (endAt && +new Date(endAt) > +new Date(at)) draft.endAt = endAt;
      if (a.allDay === true) draft.allDay = true;
      if (typeof a.location === "string" && a.location.trim()) draft.location = a.location.trim();
      if (typeof a.description === "string" && a.description.trim())
        draft.description = a.description.trim();
      if (type !== "event") draft.status = a.status ?? "todo";
      out.push({ kind: "create", summary: summary || `Add “${title}”`, draft });
      continue;
    }

    if (a.kind === "update" || a.kind === "delete") {
      const target =
        (a.itemId && byId.get(a.itemId)) ||
        (typeof a.title === "string" ? exactFind(body.items, a.title) : undefined);
      if (!target) continue;

      if (a.kind === "delete") {
        out.push({
          kind: "delete",
          summary: summary || `Delete “${target.title}”`,
          itemId: target.id,
          itemTitle: target.title,
        });
        continue;
      }

      const patch: Partial<Item> = {};
      const at = validIso(a.at);
      if (at) patch.at = at;
      if (a.clearEndAt) patch.endAt = undefined;
      else {
        const endAt = validIso(a.endAt);
        if (endAt) patch.endAt = endAt;
      }
      if (typeof a.title === "string" && a.title.trim() && a.title.trim() !== target.title)
        patch.title = a.title.trim();
      if (a.categoryId && catIds.has(a.categoryId) && a.categoryId !== target.categoryId)
        patch.categoryId = a.categoryId;
      if (a.status === "todo" || a.status === "doing" || a.status === "done") patch.status = a.status;
      if (a.clearLocation) patch.location = undefined;
      else if (
        typeof a.location === "string" &&
        a.location.trim() &&
        a.location.trim() !== target.location
      )
        patch.location = a.location.trim();
      if (a.clearDescription) patch.description = undefined;
      else if (
        typeof a.description === "string" &&
        a.description.trim() &&
        a.description.trim() !== target.description
      )
        patch.description = a.description.trim();
      if (typeof a.allDay === "boolean" && a.allDay !== Boolean(target.allDay)) patch.allDay = a.allDay;
      if (
        (a.itemType === "event" || a.itemType === "assignment" || a.itemType === "task") &&
        a.itemType !== target.type
      )
        patch.type = a.itemType;

      if (Object.keys(patch).length === 0) continue;
      out.push({
        kind: "update",
        summary: summary || `Update “${target.title}”`,
        itemId: target.id,
        itemTitle: target.title,
        patch,
      });
    }
  }
  return out.slice(0, 8);
}
