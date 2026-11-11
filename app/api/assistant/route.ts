import { NextResponse } from "next/server";
import { z } from "zod";
import { selectAssistantItems } from "@/lib/ai-assistant";
import { fixWeekdays } from "@/lib/assistant-dates";
import {
  MAX_ASSISTANT_BODY,
  MAX_ASSISTANT_ITEMS,
  MAX_ASSISTANT_MESSAGE,
  authenticationRequired,
  clientKey,
  durableHourlyLimit,
  getRequestUser,
  isJsonRequest,
  rateLimit,
  sameOrigin,
  tooMany,
} from "@/lib/api-guard";
import {
  isPureQuestion,
  normalizeActions,
  type AssistantReqBody as ReqBody,
} from "@/lib/assistant-actions";
import {
  ensureAssistantThread,
  loadAssistantHistory,
  storeAssistantMessage,
} from "@/lib/llm/history";
import { createChatCompletion, callRoutedProvider } from "@/lib/llm/router";
import { DATEBOOK_TOOLS, executeDatebookTool, MalformedToolArgumentsError } from "@/lib/llm/tools";
import type { ChatMessage } from "@/lib/llm/openai-compatible";
import { systemPrompt } from "@/lib/llm/prompt";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const modelId = z.string().trim().min(1).max(80);
const MAX_AGENT_LOOPS = 3;
// Hard cap on model calls for one user message across every provider it falls back to.
const MAX_MODEL_CALLS = 4;
const HISTORY_TURNS = 8;
const HISTORY_TURN_CHARS = 700;

/** Only recent plain user/assistant turns matter; long old replies just burn tokens. */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: (m.content as string).slice(0, HISTORY_TURN_CHARS) }));
}

function requestHistory(body: ReqBody): ChatMessage[] {
  return trimHistory(
    (body.history ?? [])
      .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
      .map((turn) => ({ role: turn.role, content: turn.text.trim() })),
  );
}

const MUTATION_TOOLS = new Set([
  "add_event",
  "update_event",
  "delete_event",
  "add_task",
  "update_task",
  "delete_task",
]);

function confirmationText(actions: unknown[]): string {
  const lines = actions
    .map((action) => (action as { summary?: unknown }).summary)
    .filter((summary): summary is string => typeof summary === "string" && Boolean(summary));
  if (lines.length === 1) return `${lines[0]}. Confirm below to apply it.`;
  return `Here's what I'll do. Confirm below to apply:\n${lines.map((line) => `- ${line}`).join("\n")}`;
}

async function runAgent(opts: {
  provider: Parameters<typeof createChatCompletion>[0]["provider"];
  key: string;
  messages: ChatMessage[];
  userId: string | null;
  threadId: string | null;
  body: ReqBody;
  budget: { left: number };
}) {
  const messages = [...opts.messages];
  const actions: unknown[] = [];
  let latencyMs = 0;
  let malformedRetries = 0;
  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop += 1) {
    if (opts.budget.left <= 0) throw new Error("Assistant model-call budget exhausted");
    opts.budget.left -= 1;
    const completion = await createChatCompletion({
      provider: opts.provider,
      key: opts.key,
      messages,
      tools: DATEBOOK_TOOLS,
    });
    latencyMs += completion.latencyMs;
    const reply = completion.message;
    messages.push(reply);
    if (!reply.tool_calls?.length) {
      return {
        text:
          reply.content?.trim() ||
          "I couldn't produce a useful answer. Try rephrasing that request.",
        actions,
        latencyMs,
      };
    }
    let allStaged = true;
    for (const call of reply.tool_calls) {
      try {
        const result = await executeDatebookTool(call.function.name, call.function.arguments, {
          userId: opts.userId,
          threadId: opts.threadId,
          body: opts.body,
        });
        if (result.action) actions.push(result.action);
        else allStaged = false;
        if (!MUTATION_TOOLS.has(call.function.name)) allStaged = false;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify(result.output),
        });
      } catch (error) {
        if (!(error instanceof MalformedToolArgumentsError) || malformedRetries >= 1) throw error;
        malformedRetries += 1;
        allStaged = false;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            error: error.details,
            retry: "Call the same tool once with valid arguments.",
          }),
        });
      }
    }
    // Every call only staged a confirmation card, so the model has nothing new to
    // reason about: skip the follow-up call (it would re-send the whole prompt) and
    // answer from the text it already wrote or the staged summaries.
    if (allStaged && actions.length) {
      return { text: reply.content?.trim() || confirmationText(actions), actions, latencyMs };
    }
  }
  throw new Error("Assistant exceeded the maximum tool-call loop count");
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "bad-request" }, { status: 400 });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_ASSISTANT_BODY) {
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  }
  const user = await getRequestUser(request);
  if (!user) return authenticationRequired();
  const limitKey = `assistant:user:${user.id}`;
  if (
    !rateLimit(limitKey, 60, 60 * 60_000) ||
    !rateLimit(`${limitKey}:${clientKey(request)}:burst`, 8, 60_000) ||
    !rateLimit("assistant:global:minute", 240, 60_000) ||
    !(await durableHourlyLimit(limitKey, 60, { failClosed: true })) ||
    !(await durableHourlyLimit("assistant:global", 3_000, { failClosed: true }))
  )
    return tooMany();

  const rawText = await request.text();
  if (rawText.length > MAX_ASSISTANT_BODY)
    return NextResponse.json({ error: "payload-too-large" }, { status: 413 });
  let body: ReqBody;
  try {
    body = JSON.parse(rawText) as ReqBody;
  } catch {
    return NextResponse.json({ error: "bad-request" }, { status: 400 });
  }
  if (!body?.message?.trim()) return NextResponse.json({ error: "empty-message" }, { status: 400 });
  if (body.message.length > MAX_ASSISTANT_MESSAGE)
    return NextResponse.json({ error: "message-too-long" }, { status: 400 });
  body.now = Number.isNaN(+new Date(body.now))
    ? new Date().toISOString()
    : new Date(body.now).toISOString();
  body.items = Array.isArray(body.items)
    ? selectAssistantItems(body.items, body.now, body.timeZone || "UTC", MAX_ASSISTANT_ITEMS)
    : [];
  body.categories = Array.isArray(body.categories) ? body.categories.slice(0, 80) : [];
  const selectedId = modelId.safeParse(body.modelId).success ? body.modelId : "auto";
  const threadId = uuid.safeParse(body.conversationId).success ? body.conversationId! : null;

  let history = requestHistory(body);
  if (threadId) {
    try {
      await ensureAssistantThread(user.id, threadId);
      const stored = await loadAssistantHistory(user.id, threadId);
      // The client's thread also holds answers produced on-device, which never reach
      // this table; only fall back to stored history when the client sent none.
      if (!history.length && stored.length) history = trimHistory(stored);
      await storeAssistantMessage({ userId: user.id, threadId, role: "user", text: body.message });
    } catch (error) {
      console.error(
        "[assistant] history write failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
  }
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(body) },
    ...history,
    { role: "user", content: body.message.trim() },
  ];

  const budget = { left: MAX_MODEL_CALLS };
  try {
    const result = await callRoutedProvider({
      selectedId,
      messages,
      tools: DATEBOOK_TOOLS,
      run: (provider, key) =>
        runAgent({ provider, key, messages, userId: user?.id ?? null, threadId, body, budget }),
    });
    let actions = normalizeActions(result.actions, body);
    if (isPureQuestion(body.message))
      actions = actions.filter((action) => action.kind !== "create");
    if (threadId) {
      try {
        await storeAssistantMessage({
          userId: user.id,
          threadId,
          role: "assistant",
          text: result.text,
          providerId: result.provider.id,
          model: result.provider.model,
        });
      } catch (error) {
        console.error(
          "[assistant] history write failed",
          error instanceof Error ? error.name : "unknown",
        );
      }
    }
    const fallbackNotice = result.fellBack
      ? `The selected model was unavailable, so Datebook used ${result.provider.label}.`
      : undefined;
    return NextResponse.json({
      // Deterministic last line of defence: a "Weekday, Month D" that
      // disagrees with the calendar is corrected rather than shown.
      text: fixWeekdays(result.text, body.now, body.timeZone || "UTC"),
      actions: actions.length ? actions : undefined,
      providerLabel: result.provider.label,
      fallbackNotice,
    });
  } catch (error) {
    console.error(
      "[assistant] all providers unavailable",
      error instanceof Error ? error.name : "unknown",
    );
    return NextResponse.json({ error: "assistant-unreachable" }, { status: 200 });
  }
}
