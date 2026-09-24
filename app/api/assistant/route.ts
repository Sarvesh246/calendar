import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAssistantDigest, selectAssistantItems } from "@/lib/ai-assistant";
import {
  MAX_ASSISTANT_BODY,
  MAX_ASSISTANT_ITEMS,
  MAX_ASSISTANT_MESSAGE,
  clientKey,
  durableHourlyLimit,
  getRequestUser,
  guestBucketKey,
  ipCeiling,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import { isPureQuestion, normalizeActions, type AssistantReqBody as ReqBody } from "@/lib/assistant-actions";
import { ensureAssistantThread, loadAssistantHistory, storeAssistantMessage } from "@/lib/llm/history";
import { createChatCompletion, callRoutedProvider } from "@/lib/llm/router";
import { DATEBOOK_TOOLS, executeDatebookTool, MalformedToolArgumentsError } from "@/lib/llm/tools";
import type { ChatMessage } from "@/lib/llm/openai-compatible";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const modelId = z.string().trim().min(1).max(80);
const MAX_AGENT_LOOPS = 6;

function systemPrompt(body: ReqBody): string {
  const now = new Date(body.now);
  const tz = body.timeZone || "UTC";
  const human = new Intl.DateTimeFormat("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: tz,
  }).format(now);
  const digest = buildAssistantDigest(
    body.items.map((item) => ({ ...item, categoryId: item.categoryId ?? "", createdAt: body.now })),
    body.categories, body.now, tz, body.weekStartsOn === 1 ? 1 : 0
  );
  const categoryNames = new Map(body.categories.map((category) => [category.id, category.name]));
  const items = body.items.slice(0, 240).map((item) => ({
    ...item,
    categoryName: item.categoryId ? categoryNames.get(item.categoryId) : undefined,
    description: item.description?.slice(0, 240),
  }));

  return `You are Datebook's calendar and todo assistant. It is ${human}; current instant ${body.now}; user timezone ${tz}. Use a ${body.clock24h ? "24-hour" : "12-hour"} clock.

Calendar categories: ${JSON.stringify(body.categories)}
Current calendar snapshot: ${JSON.stringify(items)}
Authoritative digest: ${JSON.stringify(digest)}

Answer questions precisely from the user's data. Completed work is never overdue or still due. Events are not assignments. Never invent an item. For fresh or exact DB context, call list_events or list_tasks. Every data-changing request must call the matching add/update/delete tool; do not claim it is complete because all mutations wait for the user's confirmation card. If a target is ambiguous, ask one concise question instead of calling a mutation tool. For multiline pasted schedules, blank lines separate entries and a Location line belongs to the event directly above it. Preserve every title, date, time, location, and reminder the user gave. Resolve relative dates against the current time and timezone above. Use ISO 8601 with an explicit offset in tool arguments.

Keep the final response short and natural: 1-3 sentences or a compact bullet list, no heading or table. Use bold only for useful titles, dates, times, or counts. Never expose provider internals or tool JSON.`;
}

function requestHistory(body: ReqBody): ChatMessage[] {
  return (body.history ?? [])
    .slice(-16)
    .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
    .map((turn) => ({ role: turn.role, content: turn.text.trim() }));
}

async function runAgent(opts: {
  provider: Parameters<typeof createChatCompletion>[0]["provider"];
  key: string;
  messages: ChatMessage[];
  userId: string | null;
  threadId: string | null;
  body: ReqBody;
}) {
  const messages = [...opts.messages];
  const actions: unknown[] = [];
  let latencyMs = 0;
  let malformedRetries = 0;
  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop += 1) {
    const completion = await createChatCompletion({
      provider: opts.provider, key: opts.key, messages, tools: DATEBOOK_TOOLS,
    });
    latencyMs += completion.latencyMs;
    const reply = completion.message;
    messages.push(reply);
    if (!reply.tool_calls?.length) {
      return {
        text: reply.content?.trim() || "I couldn't produce a useful answer. Try rephrasing that request.",
        actions, latencyMs,
      };
    }
    for (const call of reply.tool_calls) {
      try {
        const result = await executeDatebookTool(call.function.name, call.function.arguments, {
          userId: opts.userId, threadId: opts.threadId, body: opts.body,
        });
        if (result.action) actions.push(result.action);
        messages.push({
          role: "tool", tool_call_id: call.id, name: call.function.name,
          content: JSON.stringify(result.output),
        });
      } catch (error) {
        if (!(error instanceof MalformedToolArgumentsError) || malformedRetries >= 1) throw error;
        malformedRetries += 1;
        messages.push({
          role: "tool", tool_call_id: call.id, name: call.function.name,
          content: JSON.stringify({ error: error.details, retry: "Call the same tool once with valid arguments." }),
        });
      }
    }
  }
  throw new Error("Assistant exceeded the maximum tool-call loop count");
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const user = await getRequestUser(request);
  const ip = clientKey(request);
  const limitKey = user
    ? `assistant:user:${user.id}`
    : `assistant:ip:${guestBucketKey(request, ip)}`;
  const hourly = user ? 60 : 24;
  if (
    !rateLimit(limitKey, hourly, 60 * 60_000) ||
    !rateLimit(`${limitKey}:burst`, 8, 60_000) ||
    (!user && !ipCeiling("assistant", ip, 150, 60 * 60 * 1000)) ||
    !rateLimit("assistant:global:minute", 240, 60_000) ||
    !(await durableHourlyLimit(limitKey, hourly)) ||
    !(await durableHourlyLimit("assistant:global", 3_000))
  ) return tooMany();

  const rawText = await request.text();
  if (rawText.length > MAX_ASSISTANT_BODY) return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  let body: ReqBody;
  try {
    body = JSON.parse(rawText) as ReqBody;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (!body?.message?.trim()) return NextResponse.json({ error: "empty-message" }, { status: 400 });
  if (body.message.length > MAX_ASSISTANT_MESSAGE) return NextResponse.json({ error: "message-too-long" }, { status: 400 });
  body.now = Number.isNaN(+new Date(body.now)) ? new Date().toISOString() : new Date(body.now).toISOString();
  body.items = Array.isArray(body.items)
    ? selectAssistantItems(body.items, body.now, body.timeZone || "UTC", MAX_ASSISTANT_ITEMS)
    : [];
  body.categories = Array.isArray(body.categories) ? body.categories.slice(0, 80) : [];
  const selectedId = modelId.safeParse(body.modelId).success ? body.modelId : "auto";
  const threadId = user && uuid.safeParse(body.conversationId).success ? body.conversationId! : null;

  let history = requestHistory(body);
  if (user && threadId) {
    try {
      await ensureAssistantThread(user.id, threadId);
      const stored = await loadAssistantHistory(user.id, threadId);
      if (stored.length) history = stored;
      await storeAssistantMessage({ userId: user.id, threadId, role: "user", text: body.message });
    } catch (error) {
      console.error("[assistant] history write failed", error);
    }
  }
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(body) },
    ...history,
    { role: "user", content: body.message.trim() },
  ];

  try {
    const result = await callRoutedProvider({
      selectedId, messages, tools: DATEBOOK_TOOLS,
      run: (provider, key) => runAgent({ provider, key, messages, userId: user?.id ?? null, threadId, body }),
    });
    let actions = normalizeActions(result.actions, body);
    if (isPureQuestion(body.message)) actions = actions.filter((action) => action.kind !== "create");
    if (user && threadId) {
      try {
        await storeAssistantMessage({
          userId: user.id, threadId, role: "assistant", text: result.text,
          providerId: result.provider.id, model: result.provider.model,
        });
      } catch (error) {
        console.error("[assistant] history write failed", error);
      }
    }
    const fallbackNotice = result.fellBack
      ? `The selected model was unavailable, so Datebook used ${result.provider.label}.`
      : undefined;
    return NextResponse.json({
      text: result.text,
      actions: actions.length ? actions : undefined,
      providerLabel: result.provider.label,
      fallbackNotice,
    });
  } catch (error) {
    console.error("[assistant] all providers unavailable", error);
    return NextResponse.json({ error: "assistant-unreachable" }, { status: 200 });
  }
}
