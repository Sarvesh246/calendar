import { isUndatedAt } from "./undated";
import type { Item, ItemStatus, ItemType, RepeatFreq, RepeatRule, Reminder } from "./types";
import { nanoid } from "./nanoid";
import { countOccurrences, expandRepeat, nthWeekdayLabel } from "./repeat";
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
  /** Where the chat was opened from: a selected day, an open item, a filtered class. */
  context?: { selectedDay?: string; openItemId?: string; activeClass?: string };
  items: SlimItem[];
  itemCount?: number;
  categories: { id: string; name: string; syllabus?: unknown }[];
  pendingCreates?: { ref: string; draft: Omit<Item, "id" | "createdAt"> }[];
}

interface RawAction {
  serverActionId?: string;
  revisionOf?: string;
  kind?: "create" | "update" | "delete" | "batch";
  actions?: unknown[];
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
  repeatUntil?: string;
  /** Minutes before the start/due. Omitted = app default; [] = none. */
  reminders?: { offsetMinutes?: number; label?: string }[];
  workFor?: string;
}

export type AssistantAction =
  | { kind: "batch"; summary: string; actions: AssistantAction[] }
  | {
      kind: "create";
      summary: string;
      draft: Omit<Item, "id" | "createdAt">;
      serverActionId?: string;
      revisionOf?: string;
    }
  | {
      kind: "update";
      summary: string;
      itemId: string;
      itemTitle: string;
      patch: Partial<Item>;
      serverActionId?: string;
    }
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
      t,
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
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly")
    return undefined;
  const days = Array.isArray(a.repeatDays)
    ? [
        ...new Set(
          a.repeatDays
            .map((d) => (typeof d === "number" ? d : Number(d)))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ].sort((x, y) => x - y)
    : [];
  const until = validIso(a.until);
  const rule: RepeatRule = { freq };
  if (freq === "weekly") rule.byDay = days.length ? days : [new Date(at).getDay()];
  if (until) rule.until = until;
  return rule;
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
  const out: AssistantAction[] = [];

  for (const a of raw as RawAction[]) {
    if (!a || typeof a !== "object") continue;
    const summary = typeof a.summary === "string" && a.summary.trim() ? a.summary.trim() : "";

    if (a.kind === "batch") {
      if (
        !Array.isArray(a.actions) ||
        !a.actions.length ||
        a.actions.length > 50 ||
        a.actions.some(
          (child) => !child || typeof child !== "object" || (child as RawAction).kind !== "update",
        )
      )
        continue;
      const actions = normalizeActions(a.actions, body);
      if (actions.length !== a.actions.length) continue;
      out.push({ kind: "batch", summary: summary || "Update series", actions });
      continue;
    }

    if (a.kind === "create") {
      const title = typeof a.title === "string" ? a.title.trim() : "";
      if (!title) continue;
      const type: ItemType =
        a.itemType === "event" || a.itemType === "assignment" || a.itemType === "task"
          ? a.itemType
          : "task";
      const at = validIso(a.at);
      if (!at) continue;
      const draft: Omit<Item, "id" | "createdAt"> = {
        title,
        type,
        // No silent default: an item the model did not file stays unfiled here
        // and the client resolves it (resolveDraftClass), shows the result on
        // the card, and lets the user change it.
        categoryId: a.categoryId && catIds.has(a.categoryId) ? a.categoryId : "",
        at,
      };
      const endAt = validIso(a.endAt);
      if (endAt && +new Date(endAt) > +new Date(at)) draft.endAt = endAt;
      if (a.allDay === true) draft.allDay = true;
      if (
        typeof a.workFor === "string" &&
        byId.get(a.workFor)?.type !== "event" &&
        byId.has(a.workFor)
      )
        draft.workFor = a.workFor;
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
        ...(a.revisionOf ? { revisionOf: a.revisionOf } : {}),
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
      if (a.status === "todo" || a.status === "doing" || a.status === "done")
        patch.status = a.status;
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
      if (typeof a.allDay === "boolean" && a.allDay !== Boolean(target.allDay))
        patch.allDay = a.allDay;
      if (
        (a.itemType === "event" || a.itemType === "assignment" || a.itemType === "task") &&
        a.itemType !== target.type
      ) {
        patch.type = a.itemType;
        if (a.itemType === "event") {
          patch.status = undefined;
          patch.completedAt = undefined;
        } else if (target.type === "event") {
          patch.status = a.status ?? "todo";
          patch.endAt = undefined;
          patch.allDay = false;
        }
      }

      if (target.repeat && (a.repeatDays || a.repeatUntil)) {
        patch.repeat = {
          ...target.repeat,
          ...(a.repeatDays ? { byDay: a.repeatDays } : {}),
          ...(a.repeatUntil ? { until: a.repeatUntil } : {}),
        };
      }
      const reminders = parseActionReminders(a.reminders);
      if (reminders !== undefined)
        patch.reminders = reminders.map((r) => ({ ...r, itemId: target.id }));

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
  return out;
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

// ---------------------------------------------------------------------------
// What a card says
// ---------------------------------------------------------------------------

/** The bits of an item a card needs to say what is changing. */
export type DescribableItem = Pick<Item, "id" | "title" | "type" | "at"> &
  Partial<Pick<Item, "endAt" | "allDay" | "status" | "categoryId" | "location" | "reminders">>;

export interface ActionChange {
  field: string;
  from?: string;
  to: string;
}

export interface ActionDescription {
  /** The button label: Add, Delete, Reschedule, Complete… */
  verb: string;
  /** The item the card is about. */
  title: string;
  /** Create/delete: when it is, e.g. "Thu, Nov 12 at 7:00 PM". */
  when?: string;
  /** Create with a repeat: "Adds 12 events · every Monday until Dec 14". */
  series?: string;
  /** Update: one row per field, old → new. */
  changes: ActionChange[];
  /** Location and reminders, as a quiet line. */
  facts: string[];
  /** Create: the class it was given ("" when none exists). */
  categoryId?: string;
}

const STATUS_WORD: Record<ItemStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayWord(d: Date): string {
  return `${SHORT_DAY[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function clockWord(d: Date, clock24h: boolean): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  if (clock24h) return `${String(h).padStart(2, "0")}:${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Thu, Nov 12 at 7:00 PM"; "Fri, Nov 13" for work due at the end of a day. */
export function whenWord(
  iso: string | undefined,
  opts: { type: ItemType; allDay?: boolean; clock24h?: boolean },
): string {
  if (!iso || (opts.type !== "event" && isUndatedAt(iso))) return "no due date";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "no date";
  if (opts.allDay) return `${dayWord(d)} (all day)`;
  const endOfDay = opts.type !== "event" && d.getHours() === 23 && d.getMinutes() === 59;
  return endOfDay ? dayWord(d) : `${dayWord(d)} at ${clockWord(d, Boolean(opts.clock24h))}`;
}

export function actionVerb(a: AssistantAction): string {
  if (a.kind === "batch") return "Update";
  if (a.kind === "create") return "Add";
  if (a.kind === "delete") return "Delete";
  const p = a.patch;
  if (p.status === "done") return "Complete";
  if (p.status === "todo" || p.status === "doing") return "Reopen";
  if (p.at || "endAt" in p) return "Reschedule";
  if (p.title) return "Rename";
  if (p.categoryId) return "Recategorize";
  return "Update";
}

function weekdayList(days: number[]): string {
  const names = days.map((d) => LONG_DAY[d]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "every Monday and Wednesday"; the series wording shared by every card. */
export function repeatWord(rule: RepeatRule): string {
  if (rule.freq === "daily") return "every day";
  if (rule.freq === "yearly") return "every year";
  const nth = nthWeekdayLabel(rule);
  if (rule.freq === "monthly") return nth ? `the ${nth} of every month` : "every month";
  const days = rule.byDay?.length ? rule.byDay : [];
  if (days.length === 5 && !days.includes(0) && !days.includes(6)) return "every weekday";
  return days.length ? `every ${weekdayList(days)}` : "every week";
}

/**
 * What a card should say, built from the normalised action and the live items
 * rather than from whatever string a model wrote. Both engines render through
 * this, so a reschedule always reads "When: Thu, Nov 12 at 3:00 PM → Fri,
 * Nov 13 at 3:00 PM" and a series always says how many items it will write.
 */
export function describeAction(
  action: AssistantAction,
  items: DescribableItem[],
  clock24h = false,
  categories: { id: string; name: string }[] = [],
): ActionDescription {
  const className = (id: string | undefined) =>
    (id && categories.find((c) => c.id === id)?.name) || "No class";
  const verb = actionVerb(action);

  if (action.kind === "batch") {
    return {
      verb,
      title: action.summary,
      series: `Updates ${action.actions.length} items together`,
      facts: [],
      changes: action.actions.flatMap((child) => {
        if (child.kind !== "update") return [];
        const target = items.find((item) => item.id === child.itemId);
        return [
          {
            field: child.itemTitle,
            ...(target
              ? {
                  from: whenWord(target.at, { type: target.type, allDay: target.allDay, clock24h }),
                }
              : {}),
            to: child.patch.at
              ? whenWord(child.patch.at, {
                  type: child.patch.type ?? target?.type ?? "event",
                  allDay: child.patch.allDay ?? target?.allDay,
                  clock24h,
                })
              : "Updated",
          },
        ];
      }),
    };
  }

  if (action.kind === "create") {
    const d = action.draft;
    const facts: string[] = [];
    if (d.location) facts.push(d.location);
    const labels = d.reminders?.map((r) => r.label).filter(Boolean);
    if (labels?.length) facts.push(labels.join(", "));
    const out: ActionDescription = {
      verb,
      title: d.title,
      when: whenWord(d.at, { type: d.type, allDay: d.allDay, clock24h }),
      changes: [],
      facts,
      categoryId: d.categoryId,
    };
    if (d.endAt && d.type === "event" && !d.repeat) {
      const end = new Date(d.endAt);
      if (d.allDay) {
        // All-day end dates are exclusive in the calendar store.
        end.setDate(end.getDate() - 1);
        if (end.toDateString() !== new Date(d.at).toDateString())
          out.when = `${dayWord(new Date(d.at))} – ${dayWord(end)} (all day)`;
      } else {
        out.when += ` – ${end.toDateString() === new Date(d.at).toDateString() ? clockWord(end, clock24h) : `${dayWord(end)} at ${clockWord(end, clock24h)}`}`;
      }
    }
    if (d.repeat) {
      // The first real occurrence, not the anchor the rule was built from:
      // "every Wednesday" asked on a Tuesday starts tomorrow.
      const first = expandRepeat(d.at, d.endAt, d.repeat)[0];
      if (first) out.when = whenWord(first.at, { type: d.type, allDay: d.allDay, clock24h });
      const count = countOccurrences(d.at, d.endAt, d.repeat);
      const noun = d.type === "event" ? "events" : "items";
      const until = d.repeat.until
        ? ` until ${dayWord(new Date(d.repeat.until))}`
        : " with no end date";
      out.series = `Adds ${count} ${noun} · ${repeatWord(d.repeat)}${until}`;
    }
    return out;
  }

  const target = items.find((i) => i.id === action.itemId);
  const targetWhen = target
    ? whenWord(target.at, { type: target.type, allDay: target.allDay, clock24h })
    : undefined;
  if (action.kind === "delete") {
    return { verb, title: action.itemTitle, when: targetWhen, changes: [], facts: [] };
  }

  const p = action.patch;
  const type = p.type ?? target?.type ?? "event";
  const changes: ActionChange[] = [];
  if (p.at) {
    changes.push({
      field: type === "event" ? "When" : "Due",
      from: targetWhen,
      to: whenWord(p.at, { type, allDay: p.allDay ?? target?.allDay, clock24h }),
    });
  }
  if ("endAt" in p) {
    changes.push({
      field: "Ends",
      from: target?.endAt ? clockWord(new Date(target.endAt), clock24h) : undefined,
      to: p.endAt ? clockWord(new Date(p.endAt), clock24h) : "no end time",
    });
  }
  if (p.title) changes.push({ field: "Title", from: action.itemTitle, to: p.title });
  if (p.status) {
    changes.push({
      field: "Status",
      from: target?.status ? STATUS_WORD[target.status] : undefined,
      to: STATUS_WORD[p.status],
    });
  }
  if (p.categoryId) {
    changes.push({
      field: "Class",
      from: target ? className(target.categoryId) : undefined,
      to: className(p.categoryId),
    });
  }
  if ("location" in p) {
    changes.push({ field: "Location", from: target?.location, to: p.location ?? "removed" });
  }
  if ("description" in p) {
    changes.push({ field: "Notes", to: p.description ? "updated" : "cleared" });
  }
  if (typeof p.allDay === "boolean") {
    changes.push({
      field: "All day",
      from: target?.allDay ? "yes" : "no",
      to: p.allDay ? "yes" : "no",
    });
  }
  if (p.repeat) changes.push({ field: "Repeat", to: repeatWord(p.repeat) });
  if (p.type && p.type !== target?.type) {
    changes.push({ field: "Type", from: target?.type, to: p.type });
  }
  if (p.reminders) {
    const labels = p.reminders.map((r) => r.label).filter(Boolean);
    changes.push({ field: "Reminders", to: labels.length ? labels.join(", ") : "none" });
  }
  return { verb, title: action.itemTitle, changes, facts: [] };
}

/**
 * The class a created item will actually be filed under: the one the model
 * named if it exists, else the class implied by where the chat was opened (a
 * single filtered class), else the app's fallback — the order the composer
 * uses, so a card never says "No class" for an item that lands in the first.
 */
export function resolveDraftClass(
  draft: { categoryId?: string },
  categories: { id: string }[],
  contextCategoryId?: string | null,
): string {
  const valid = (id: string | undefined | null): id is string =>
    Boolean(id) && categories.some((c) => c.id === id);
  if (valid(draft.categoryId)) return draft.categoryId;
  if (valid(contextCategoryId)) return contextCategoryId;
  return categories[0]?.id ?? "";
}
