import { NextResponse } from "next/server";
import { z } from "zod";
import { selectAssistantItems } from "@/lib/ai-assistant";
import { fixWeekdays } from "@/lib/assistant-dates";
import { polishReply } from "@/lib/assistant-polish";
import { cleanChoices, cleanItemsBlocks } from "@/lib/assistant-parts";
import {
  MAX_ASSISTANT_BODY,
  MAX_ASSISTANT_ITEMS,
  MAX_ASSISTANT_MESSAGE,
  authenticationRequired,
  durableHourlyLimit,
  getRequestUser,
  isJsonRequest,
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
import { callRoutedProvider } from "@/lib/llm/router";
import { AssistantInterpretationError, runAgent } from "@/lib/llm/agent";
import { DATEBOOK_TOOLS } from "@/lib/llm/tools";
import type { ChatMessage } from "@/lib/llm/openai-compatible";
import { systemPrompt } from "@/lib/llm/prompt";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const modelId = z.string().trim().min(1).max(80);
// Hard cap on model calls for one user message across every provider it falls back to.
const MAX_MODEL_CALLS = 6;
const HISTORY_TURNS = 8;
const HISTORY_TURN_CHARS = 700;
const LAST_ASSISTANT_TURN_CHARS = 4_000;

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
    .map((m, i, all) => {
      const text = m.content as string;
      // The last assistant turn is what "that one" and "move it" refer to:
      // keep it whole (within reason). Older turns are only context.
      const lastAssistant =
        m.role === "assistant" && i === all.map((x) => x.role).lastIndexOf("assistant");
      return {
        role: m.role,
        content: text.slice(0, lastAssistant ? LAST_ASSISTANT_TURN_CHARS : HISTORY_TURN_CHARS),
      };
    });
}

function requestHistory(body: ReqBody): ChatMessage[] {
  return trimHistory(
    (body.history ?? [])
      .filter((turn) => turn && typeof turn.text === "string" && turn.text.trim())
      .map((turn) => ({ role: turn.role, content: turn.text.trim() })),
  );
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
    // Every limit is durable: per-instance counters reset on each cold start
    // and are not shared between instances, so they limited almost nothing.
    !(await durableHourlyLimit(`${limitKey}:burst`, 8, { failClosed: true, windowMs: 60_000 })) ||
    !(await durableHourlyLimit("assistant:global:minute", 240, {
      failClosed: true,
      windowMs: 60_000,
    })) ||
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
  body.pendingCreates = Array.isArray(body.pendingCreates) ? body.pendingCreates.slice(-8) : [];
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

  /** Run the agent and build the response payload; `stream` taps the text. */
  const compute = async (stream?: { onText: (d: string) => void; onReset: () => void }) => {
    const result = await callRoutedProvider({
      selectedId,
      mutation:
        /\b(?:add|create|schedule|book|put|remind|move|reschedule|change|edit|rename|delete|remove|cancel|mark|complete|convert|plan|make it|actually)\b/i.test(
          body.message,
        ),
      messages,
      tools: DATEBOOK_TOOLS,
      run: (provider, key) => {
        // A fallback provider starts the reply over.
        stream?.onReset();
        return runAgent({
          provider,
          key,
          messages,
          userId: user?.id ?? null,
          threadId,
          body,
          budget,
          stream,
        });
      },
    });
    let actions = normalizeActions(result.actions, body);
    const droppedActions = result.actions.length - actions.length;
    const blockedCreates =
      isPureQuestion(body.message) && actions.some((action) => action.kind === "create");
    if (blockedCreates) actions = actions.filter((action) => action.kind !== "create");
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
    return {
      // Deterministic last line of defence: a "Weekday, Month D" that
      // disagrees with the calendar is corrected rather than shown.
      text: blockedCreates
        ? "I did not add anything. Please tell me explicitly if you want to create an item."
        : droppedActions > 0
          ? `I couldn't prepare ${droppedActions === 1 ? "one change" : `${droppedActions} changes`}. ${actions.length ? "Review the remaining cards and ask again about the missing changes." : "Please clarify and try again."}`
          : fixWeekdays(polishReply(result.text), body.now, body.timeZone || "UTC"),
      items: cleanItemsBlocks(result.items),
      choices: cleanChoices(result.choices),
      actions: actions.length ? actions : undefined,
      providerLabel: result.provider.label,
      fallbackNotice,
    };
  };

  const logFailure = (error: unknown) =>
    console.error(
      "[assistant] all providers unavailable",
      error instanceof Error ? error.name : "unknown",
    );

  // Server-sent events: text as it is written, then one final event carrying the
  // finished reply with its cards. Errors are typed, never a 200 that hides them.
  if ((request.headers.get("accept") ?? "").includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          const payload = await compute({
            onText: (delta) => send("text", { delta }),
            onReset: () => send("reset", {}),
          });
          send("done", payload);
        } catch (error) {
          logFailure(error);
          send("error", {
            error:
              error instanceof AssistantInterpretationError
                ? "assistant-interpretation"
                : "assistant-unreachable",
          });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    return NextResponse.json(await compute());
  } catch (error) {
    logFailure(error);
    return NextResponse.json(
      {
        error:
          error instanceof AssistantInterpretationError
            ? "assistant-interpretation"
            : "assistant-unreachable",
      },
      { status: 502 },
    );
  }
}
