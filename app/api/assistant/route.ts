import { NextResponse } from "next/server";
import { buildAssistantDigest } from "@/lib/ai-assistant";
import {
  MAX_ASSISTANT_BODY,
  MAX_ASSISTANT_ITEMS,
  MAX_ASSISTANT_MESSAGE,
  clientKey,
  durableHourlyLimit,
  getRequestUser,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import {
  isPureQuestion,
  normalizeActions,
  type AssistantReqBody as ReqBody,
} from "@/lib/assistant-actions";

export const runtime = "nodejs";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const KEY = process.env.GEMINI_API_KEY;
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
          clearLocation: { type: "BOOLEAN" },
          clearDescription: { type: "BOOLEAN" },
        },
        required: ["kind", "summary"],
        propertyOrdering: [
          "kind", "summary", "itemId", "title", "itemType", "at", "endAt",
          "allDay", "location", "description", "categoryId", "status", "clearEndAt",
          "clearLocation", "clearDescription",
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

  const catById = new Map(body.categories.map((c) => [c.id, c.name]));
  const digest = buildAssistantDigest(
    body.items.map((i) => ({
      ...i,
      categoryId: i.categoryId ?? "",
      createdAt: body.now,
    })),
    body.categories,
    body.now,
    tz,
    body.weekStartsOn === 1 ? 1 : 0
  );

  // Keep the payload bounded (latency): nearest ~180 items to "now", trimmed
  // descriptions.
  const items = [...body.items]
    .sort(
      (a, b) =>
        Math.abs(+new Date(a.at) - +now) - Math.abs(+new Date(b.at) - +now)
    )
    .slice(0, 180)
    .map((i) => ({
      ...i,
      categoryName: i.categoryId ? catById.get(i.categoryId) : undefined,
      description: i.description ? i.description.slice(0, 180) : undefined,
    }));

  return `You are the assistant built into "Datebook", a personal calendar and task app. You help the signed-in user with ANYTHING about their own schedule: their events, assignments/coursework, tasks, deadlines, workload, free time, and what's coming up.

Right now it is ${human} (timezone ${tz}). Current instant: ${body.now}. The user uses a ${body.clock24h ? "24-hour" : "12-hour"} clock.

The user's full calendar is below as JSON.
CATEGORIES (id → name): ${JSON.stringify(body.categories)}
ITEMS: ${JSON.stringify(items)}

PRE-COMPUTED DIGEST (authoritative — prefer this over re-deriving counts from ITEMS when they disagree):
${JSON.stringify(digest)}

Item shape: type is "event" (something happening at a time — class, meeting, appointment), "assignment" (due-dated coursework: ${ASSIGNMENT_WORDS}), or "task" (a to-do). "at" is the start time for events and the due time for assignments/tasks. "status" (todo/doing/done) applies to assignments and tasks only. "categoryId" / "categoryName" map to the class/course. "url" (when present) is a link to the source page (e.g. the Canvas assignment); "description" and "location" carry any extra detail the feed provided.

STATUS & DUE SEMANTICS — follow strictly:
- "done" means finished. A done item is NEVER overdue, NEVER "still due", and NEVER counted in "how many do I have left", "how many due", "due by Sunday", or similar open-work questions unless the user explicitly asks about completed/finished work.
- "doing" means in progress — it still counts as open work.
- "todo" (or unset status) with a due datetime in the past = overdue (unless done).
- "Due by Sunday" = open assignments and tasks whose due date is on or before the coming calendar Sunday (today if today is Sunday). "Due this week" = open work from today through the end of the user's calendar week (week starts ${body.weekStartsOn === 1 ? "Monday" : "Sunday"}). Neither includes events.
- Events are not assignments — never mix events into due-counts or overdue lists unless the user asks about events specifically.
- When the DIGEST and raw ITEMS disagree on counts or membership, trust the DIGEST.
- Only mention completed work (digest.completedLast7Days) when the user asks what they finished, completed, or checked off. Prefer items with a completed-at timestamp; otherwise the due date is used.

YOUR TWO MODES — infer which from the message. When in doubt, ANSWER; only CHANGE the calendar when the user clearly asks you to.
1. ANSWER a question (this is the common case — a chatbot about their calendar). Triggers: "what/when/where/how many/how much/do I have/is there/am I free/show me/list/tell me/which/what's it for/what class…". Answer precisely from the DIGEST and ITEMS above — cite real titles, classes (category names), due dates, times (format for a ${body.clock24h ? "24-hour" : "12-hour"} clock), locations, and links where relevant. Use the DIGEST for counts and date-bounded lists. If nothing matches, say so plainly. Never invent items. Do NOT return any actions for a pure question — answering IS the response.
2. CHANGE the calendar. Triggers: "add/create/schedule/put/new/set up/block off/remind me to/move/reschedule/push/bump/rename/retitle/change/mark/complete/finish/check off/reopen/delete/remove/cancel/clear…". Return one action per change in "actions". Never claim it's done — the user taps to confirm each action in the UI. Still write a short natural "reply" describing what you're proposing.
A single message can do both (e.g. "what's Friday look like? move the 3pm to Saturday" → answer + one update action).

ACTION RULES:
- create: set "title", "itemType", "at" (full ISO 8601 WITH the user's timezone offset). Optional: "endAt", "allDay", "location", "description", "categoryId" (must be an id from CATEGORIES, else omit). Choose itemType by meaning. If the user gave no time: events → 12:00 local, assignments/tasks → 23:59 local. If they gave no date, assume today (or the soonest sensible date).
- update: set "itemId" (from ITEMS — you resolve it by matching the user's words to a real item) plus ONLY the fields that change: "at" and/or "endAt" to reschedule, "clearEndAt": true to drop an end time, "title" to rename, "categoryId" to recategorize, "status" to "done" to complete / "todo" to reopen, "location"/"description"/"allDay" as needed. Send "location"/"description" ONLY when giving a new value; to remove one entirely set "clearLocation": true / "clearDescription": true. Never send an empty string for a field you don't want changed.
- delete: set "itemId".
- If the user's target is ambiguous (multiple plausible items) or missing, return NO actions and ask a short clarifying question in "reply".
- "summary" (required on every action) is one plain sentence for a confirmation card, e.g. 'Move "Bio lab report" to Fri Aug 29, 11:59 PM' or 'Add event "Dentist" on Wed Sep 3, 2:00–3:00 PM'.
- Resolve all relative dates ("tomorrow", "next Friday", "in 2 weeks", "the 14th") against the current date above.

"suggestions": optionally 2-3 very short follow-up prompts the user might tap next. Make them specific to THIS conversation, not generic.

REPLY STYLE — this renders in a narrow chat bubble on a phone:
- Keep it short: 1-3 sentences, or a bullet list. No preamble, no "Sure!", no restating the question.
- Use **bold** ONLY for item titles, dates, times, and counts. Never bold whole sentences.
- When listing 3+ items, use "- " bullets, one item per line: "- **Bio lab report** — due Fri, 11:59 PM".
- No headings, no tables. Plain, friendly, direct.
- Format every time for a ${body.clock24h ? "24-hour" : "12-hour"} clock. Use short weekday+date ("Fri, Aug 29"), not ISO, in the reply text.
- A long imported title may be shortened naturally in prose as long as it stays recognisable.
- Treat the conversation so far as context — a terse follow-up like "how about sunday?" or "and next week?" refers to the previous question.

Reply ONLY with JSON matching the schema. "reply" is always present.`;
}

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  if (!KEY) {
    return NextResponse.json({ error: "assistant-not-configured" }, { status: 200 });
  }
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const user = await getRequestUser(request);
  const ip = clientKey(request);
  const limitKey = user ? `assistant:user:${user.id}` : `assistant:ip:${ip}`;
  const hourly = user ? 60 : 20;
  if (
    !rateLimit(limitKey, hourly, 60 * 60 * 1000) ||
    !rateLimit(`${limitKey}:burst`, 8, 60_000) ||
    !(await durableHourlyLimit(limitKey, hourly))
  ) {
    return tooMany();
  }

  const rawText = await request.text();
  if (rawText.length > MAX_ASSISTANT_BODY) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }
  let body: ReqBody;
  try {
    body = JSON.parse(rawText) as ReqBody;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "empty-message" }, { status: 400 });
  }
  if (body.message.length > MAX_ASSISTANT_MESSAGE) {
    return NextResponse.json({ error: "message-too-long" }, { status: 400 });
  }
  body.items = Array.isArray(body.items) ? body.items.slice(0, MAX_ASSISTANT_ITEMS) : [];
  body.categories = Array.isArray(body.categories) ? body.categories.slice(0, 80) : [];

  // Gemini requires `contents` to start with a `user` turn and to alternate
  // roles. Build history defensively: drop the leading assistant greeting(s) and
  // collapse any accidental same-role run (keeping the latest of the run).
  const turns: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of (body.history ?? []).slice(-10)) {
    if (!m || typeof m.text !== "string" || !m.text.trim()) continue;
    const role = m.role === "assistant" ? "model" : "user";
    if (turns.length === 0 && role === "model") continue; // no leading model turn
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.parts = [{ text: m.text }];
    else turns.push({ role, parts: [{ text: m.text }] });
  }
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === "user") lastTurn.parts.push({ text: body.message });
  else turns.push({ role: "user", parts: [{ text: body.message }] });
  const contents = turns;

  const payload = JSON.stringify({
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
  });

  // Gemini flash returns a transient 503 ("high demand") or 429 fairly often;
  // a couple of quick retries usually clear it and are far better UX than
  // dropping straight to the offline heuristic.
  const TRANSIENT = new Set([429, 500, 503]);
  let data: unknown;
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(400 * attempt + Math.random() * 300);
    let r: Response;
    try {
      r = await fetch(`${ENDPOINT(MODEL)}?key=${KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(13_000),
      });
    } catch (err) {
      lastStatus = 0;
      console.error("[assistant] request failed (attempt", attempt + 1 + ")", err);
      continue;
    }
    if (r.ok) {
      data = await r.json();
      break;
    }
    lastStatus = r.status;
    const detail = await r.text().catch(() => "");
    console.error("[assistant] Gemini error", r.status, detail.slice(0, 300));
    if (!TRANSIENT.has(r.status)) break;
  }
  if (data === undefined) {
    return NextResponse.json(
      { error: lastStatus === 429 || lastStatus === 503 ? "assistant-busy" : "assistant-unreachable" },
      { status: 200 }
    );
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
