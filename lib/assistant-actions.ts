import type { Item, ItemStatus, ItemType, RepeatFreq, RepeatRule, Reminder } from "./types";
import { wallTimeInZoneToIso } from "./date-utils";
import { zonedDateKey } from "./ai-assistant";
import { nanoid } from "./nanoid";
import { formatOffsetLabel } from "./reminder-defaults";

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
  sourceId?: string;
  sourceUid?: string;
  completedAt?: string;
  repeat?: RepeatRule;
  repeatId?: string;
}

export interface AssistantReqBody {
  message: string;
  modelId?: string;
  conversationId?: string;
  history?: { role: "user" | "assistant"; text: string }[];
  now: string;
  timeZone?: string;
  clock24h?: boolean;
  weekStartsOn?: 0 | 1;
  items: SlimItem[];
  categories: { id: string; name: string }[];
}

interface RawAction {
  serverActionId?: string;
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
  repeatFreq?: RepeatFreq;
  /** 0 = Sunday … 6 = Saturday. Weekly class meetings. */
  repeatDays?: number[];
  until?: string;
  /** Minutes before the start/due. Omitted = app default; [] = none. */
  reminders?: { offsetMinutes?: number; label?: string }[];
}

export type AssistantAction =
  | { kind: "create"; summary: string; draft: Omit<Item, "id" | "createdAt">; serverActionId?: string }
  | { kind: "update"; summary: string; itemId: string; itemTitle: string; patch: Partial<Item>; serverActionId?: string }
  | { kind: "delete"; summary: string; itemId: string; itemTitle: string; serverActionId?: string };

export function isPureQuestion(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  const mutation =
    /\b(add|create|schedule|new|set up|setup|book|block off|put|make|pencil|write down|don't forget|dont forget|ping me|nudge|notify me|alert me|remind me|i need|i have a|on my calendar|onto my calendar|move|reschedule|push|bump|shift|rename|retitle|change|mark|complete|finish|check off|reopen|delete|remove|cancel|clear)\b/;
  if (mutation.test(t)) return false;
  return (
    t.endsWith("?") ||
    /^(what|when|where|which|who|why|how|do i|did i|have i|am i|is there|are there|will i|can you|could you|would you|should i|show me|list|tell me)\b/.test(
      t
    )
  );
}

function validIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(+d) ? undefined : d.toISOString();
}

function parseRepeat(a: RawAction, at: string): RepeatRule | undefined {
  const freq = a.repeatFreq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") return undefined;
  const days = Array.isArray(a.repeatDays)
    ? [
        ...new Set(
          a.repeatDays
            .map((d) => (typeof d === "number" ? d : Number(d)))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ),
      ].sort((x, y) => x - y)
    : [];
  const until = validIso(a.until);
  const rule: RepeatRule = { freq };
  if (freq === "weekly") rule.byDay = days.length ? days : [new Date(at).getDay()];
  if (until) rule.until = until;
  return rule;
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
      const repeat = parseRepeat(a, at);
      if (repeat) draft.repeat = repeat;
      const reminders = parseActionReminders(a.reminders);
      if (reminders !== undefined) draft.reminders = reminders;
      out.push({
        kind: "create",
        summary: summary || `Add “${title}”`,
        draft,
        ...(a.serverActionId ? { serverActionId: a.serverActionId } : {}),
      });
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
          ...(a.serverActionId ? { serverActionId: a.serverActionId } : {}),
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

      const reminders = parseActionReminders(a.reminders);
      if (reminders !== undefined) patch.reminders = reminders.map((r) => ({ ...r, itemId: target.id }));

      if (Object.keys(patch).length === 0) continue;
      out.push({
        kind: "update",
        summary: summary || `Update “${target.title}”`,
        itemId: target.id,
        itemTitle: target.title,
        patch,
        ...(a.serverActionId ? { serverActionId: a.serverActionId } : {}),
      });
    }
  }
  return out.slice(0, 8);
}

const MAX_REMINDER_OFFSET = 14 * 24 * 60;

/** `undefined` = caller should use app defaults; `[]` = explicitly none. */
export function parseActionReminders(raw: unknown): Reminder[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length === 0) return [];
  const out: Reminder[] = [];
  const seen = new Set<number>();
  for (const entry of raw.slice(0, 4)) {
    const mins =
      typeof entry === "number"
        ? entry
        : entry && typeof entry === "object" && "offsetMinutes" in entry
          ? Number((entry as { offsetMinutes: unknown }).offsetMinutes)
          : NaN;
    if (!Number.isFinite(mins)) continue;
    const offsetMinutes = Math.round(mins);
    if (offsetMinutes < 1 || offsetMinutes > MAX_REMINDER_OFFSET) continue;
    if (seen.has(offsetMinutes)) continue;
    seen.add(offsetMinutes);
    const label =
      entry &&
      typeof entry === "object" &&
      "label" in entry &&
      typeof (entry as { label: unknown }).label === "string" &&
      (entry as { label: string }).label.trim()
        ? (entry as { label: string }).label.trim()
        : formatOffsetLabel(offsetMinutes);
    out.push({ id: nanoid(), itemId: "", offsetMinutes, label });
  }
  return out.length ? out : undefined;
}
