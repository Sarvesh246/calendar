import { NextResponse } from "next/server";
import type { Item, ItemStatus, ItemType } from "@/lib/types";

export const runtime = "nodejs";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const KEY = process.env.GEMINI_API_KEY;
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/* ------------------------------------------------------------------ */
/* Request / wire types                                                */
/* ------------------------------------------------------------------ */

interface SlimItem {
  id: string;
  title: string;
  type: ItemType;
  at: string;
  endAt?: string;
  allDay?: boolean;
  status?: ItemStatus;
  categoryId?: string;
  location?: string;
  description?: string;
  url?: string;
}

interface ReqBody {
  message: string;
  history?: { role: "user" | "assistant"; text: string }[];
  now: string;
  timeZone?: string;
  clock24h?: boolean;
  items: SlimItem[];
  categories: { id: string; name: string }[];
}

/** Raw action shape Gemini emits (flat — unions don't round-trip cleanly). */
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
}

/** Store-ready action the client can apply directly. */
type AssistantAction =
  | { kind: "create"; summary: string; draft: Omit<Item, "id" | "createdAt"> }
  | { kind: "update"; summary: string; itemId: string; itemTitle: string; patch: Partial<Item> }
  | { kind: "delete"; summary: string; itemId: string; itemTitle: string };

/* ------------------------------------------------------------------ */
/* Gemini response schema                                              */
/* ------------------------------------------------------------------ */

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" },
    suggestions: { type: "ARRAY", items: { type: "STRING" } },
    actions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["create", "update", "delete"] },
          summary: { type: "STRING" },
          itemId: { type: "STRING" },
          title: { type: "STRING" },
          itemType: { type: "STRING", enum: ["event", "assignment", "task"] },
          at: { type: "STRING" },
          endAt: { type: "STRING" },
          allDay: { type: "BOOLEAN" },
          location: { type: "STRING" },
          description: { type: "STRING" },
          categoryId: { type: "STRING" },
          status: { type: "STRING", enum: ["todo", "doing", "done"] },
          clearEndAt: { type: "BOOLEAN" },
        },
        required: ["kind", "summary"],
        propertyOrdering: [
          "kind", "summary", "itemId", "title", "itemType", "at", "endAt",
          "allDay", "location", "description", "categoryId", "status", "clearEndAt",
        ],
      },
    },
  },
  required: ["reply"],
  propertyOrdering: ["reply", "suggestions", "actions"],
} as const;

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const ASSIGNMENT_WORDS =
  "homework, hw, reading, problem set, pset, quiz, exam, midterm, final, essay, paper, lab, report, project, milestone, assignment";

function systemPrompt(body: ReqBody): string {
  const now = new Date(body.now);
  const tz = body.timeZone || "UTC";
  const human = new Intl.DateTimeFormat("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: tz,
  }).format(now);

  // Keep the payload bounded: nearest ~250 items to "now", trimmed descriptions.
  const items = [...body.items]
    .sort(
      (a, b) =>
        Math.abs(+new Date(a.at) - +now) - Math.abs(+new Date(b.at) - +now)
    )
    .slice(0, 250)
    .map((i) => ({
      ...i,
      description: i.description ? i.description.slice(0, 240) : undefined,
    }));

  return `You are the assistant built into "Datebook", a personal calendar and task app. You help the signed-in user with ANYTHING about their own schedule: their events, assignments/coursework, tasks, deadlines, workload, free time, and what's coming up.

Right now it is ${human} (timezone ${tz}). Current instant: ${body.now}. The user uses a ${body.clock24h ? "24-hour" : "12-hour"} clock.

The user's full calendar is below as JSON.
CATEGORIES (id → name): ${JSON.stringify(body.categories)}
ITEMS: ${JSON.stringify(items)}

Item shape: type is "event" (something happening at a time — class, meeting, appointment), "assignment" (due-dated coursework: ${ASSIGNMENT_WORDS}), or "task" (a to-do). "at" is the start time for events and the due time for assignments/tasks. "status" (todo/doing/done) applies to assignments and tasks only. "categoryId" maps to a CATEGORY name — for imported coursework that name IS the class/course. "url" (when present) is a link to the source page (e.g. the Canvas assignment); "description" and "location" carry any extra detail the feed provided.

YOUR TWO MODES — infer which from the message. When in doubt, ANSWER; only CHANGE the calendar when the user clearly asks you to.
1. ANSWER a question (this is the common case — a chatbot about their calendar). Triggers: "what/when/where/how many/how much/do I have/is there/am I free/show me/list/tell me/which/what's it for/what class…". Answer precisely from the ITEMS above — cite real titles, classes (category names), due dates, times (format for a ${body.clock24h ? "24-hour" : "12-hour"} clock), locations, and links where relevant. Do maths yourself (counts, gaps, busiest day, free windows, time until X). If nothing matches, say so plainly. Never invent items. Do NOT return any actions for a pure question — answering IS the response.
2. CHANGE the calendar. Triggers: "add/create/schedule/put/new/set up/block off/remind me to/move/reschedule/push/bump/rename/retitle/change/mark/complete/finish/check off/reopen/delete/remove/cancel/clear…". Return one action per change in "actions". Never claim it's done — the user taps to confirm each action in the UI. Still write a short natural "reply" describing what you're proposing.
A single message can do both (e.g. "what's Friday look like? move the 3pm to Saturday" → answer + one update action).

ACTION RULES:
- create: set "title", "itemType", "at" (full ISO 8601 WITH the user's timezone offset). Optional: "endAt", "allDay", "location", "description", "categoryId" (must be an id from CATEGORIES, else omit). Choose itemType by meaning. If the user gave no time: events → 12:00 local, assignments/tasks → 23:59 local. If they gave no date, assume today (or the soonest sensible date).
- update: set "itemId" (from ITEMS — you resolve it by matching the user's words to a real item) plus ONLY the fields that change: "at" and/or "endAt" to reschedule, "clearEndAt": true to drop an end time, "title" to rename, "categoryId" to recategorize, "status" to "done" to complete / "todo" to reopen, "location"/"description"/"allDay" as needed.
- delete: set "itemId".
- If the user's target is ambiguous (multiple plausible items) or missing, return NO actions and ask a short clarifying question in "reply".
- "summary" (required on every action) is one plain sentence for a confirmation card, e.g. 'Move "Bio lab report" to Fri Aug 29, 11:59 PM' or 'Add event "Dentist" on Wed Sep 3, 2:00–3:00 PM'.
- Resolve all relative dates ("tomorrow", "next Friday", "in 2 weeks", "the 14th") against the current date above.

"suggestions": optionally 2-3 very short follow-up prompts the user might tap next.

Reply ONLY with JSON matching the schema. "reply" is always present.`;
}

/* ------------------------------------------------------------------ */
/* Validation / normalisation of model output                          */
/* ------------------------------------------------------------------ */

function normalizeActions(
  raw: unknown,
  body: ReqBody
): AssistantAction[] {
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
      const at = validIso(a.at) ?? defaultAt(type, body.now);
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
        (a.title ? fuzzyFind(body.items, a.title) : undefined);
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
      if (a.status === "todo" || a.status === "doing" || a.status === "done")
        patch.status = a.status;
      if (typeof a.location === "string") patch.location = a.location.trim() || undefined;
      if (typeof a.description === "string") patch.description = a.description.trim() || undefined;
      if (typeof a.allDay === "boolean") patch.allDay = a.allDay;
      if (a.itemType === "event" || a.itemType === "assignment" || a.itemType === "task")
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

/** True when the message reads as a pure question with no request to change
 *  anything — used to suppress spurious "create" actions from the model. */
function isPureQuestion(message: string): boolean {
  const t = message.trim().toLowerCase();
  if (!t) return false;
  const mutation =
    /\b(add|create|schedule|new|set up|book|block off|remind me to|move|reschedule|push|bump|shift|rename|retitle|change|mark|complete|finish|check off|reopen|delete|remove|cancel|clear)\b/;
  if (mutation.test(t)) return false;
  return t.endsWith("?") || /^(what|when|where|which|who|why|how|do i|did i|have i|am i|is there|are there|will i|can you|could you|should i|show me|list|tell me)\b/.test(t);
}

function validIso(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(+d) ? undefined : d.toISOString();
}

function defaultAt(type: ItemType, nowIso: string): string {
  const d = new Date(nowIso);
  if (type === "event") d.setHours(12, 0, 0, 0);
  else d.setHours(23, 59, 0, 0);
  return d.toISOString();
}

function fuzzyFind(items: SlimItem[], q: string): SlimItem | undefined {
  const needle = q.trim().toLowerCase();
  if (!needle) return undefined;
  return (
    items.find((i) => i.title.toLowerCase() === needle) ||
    items.find((i) => i.title.toLowerCase().includes(needle)) ||
    items.find((i) => needle.includes(i.title.toLowerCase())) ||
    items.find((i) => {
      const w = needle.split(/\s+/).filter((t) => t.length > 2);
      return w.length > 0 && w.every((t) => i.title.toLowerCase().includes(t));
    })
  );
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  if (!KEY) {
    return NextResponse.json({ error: "assistant-not-configured" }, { status: 200 });
  }

  let body: ReqBody;
  try {
    body = (await request.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "empty-message" }, { status: 400 });
  }
  body.items = Array.isArray(body.items) ? body.items : [];
  body.categories = Array.isArray(body.categories) ? body.categories : [];

  const contents = [
    ...(body.history ?? [])
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .slice(-10)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
    { role: "user", parts: [{ text: body.message }] },
  ];

  let data: unknown;
  try {
    const r = await fetch(`${ENDPOINT(MODEL)}?key=${KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(body) }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          // Structured extraction, not open reasoning — keep the "thinking" pass
          // light so replies come back quickly.
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("[assistant] Gemini error", r.status, detail.slice(0, 500));
      return NextResponse.json({ error: "assistant-upstream" }, { status: 200 });
    }
    data = await r.json();
  } catch (err) {
    console.error("[assistant] request failed", err);
    return NextResponse.json({ error: "assistant-unreachable" }, { status: 200 });
  }

  const textOut: string =
    (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
      ?.candidates?.[0]?.content?.parts?.map((p) => p?.text ?? "").join("") ?? "";

  let parsed: { reply?: string; suggestions?: unknown; actions?: unknown };
  try {
    parsed = JSON.parse(textOut);
  } catch {
    // Model occasionally wraps JSON in prose — grab the outermost object.
    const m = textOut.match(/\{[\s\S]*\}/);
    try {
      parsed = m ? JSON.parse(m[0]) : {};
    } catch {
      parsed = {};
    }
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "Sorry — I couldn't work that one out. Try rephrasing?";
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, 3)
    : undefined;
  let actions = normalizeActions(parsed.actions, body);
  // The model occasionally answers a question AND proposes creating an item that
  // just echoes the question. Drop creates when nothing was actually asked to change.
  if (actions && isPureQuestion(body.message)) {
    actions = actions.filter((a) => a.kind !== "create");
  }

  return NextResponse.json({
    text: reply,
    suggestions,
    actions: actions && actions.length ? actions : undefined,
  });
}
