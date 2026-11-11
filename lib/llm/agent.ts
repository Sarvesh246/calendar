import {
  correctiveMessage,
  findMissingDetails,
  type StagedAdd,
} from "@/lib/assistant-completeness";
import type { AssistantReqBody as ReqBody } from "@/lib/assistant-actions";
import { createChatCompletion } from "./router";
import { DATEBOOK_TOOLS, executeDatebookTool, MalformedToolArgumentsError } from "./tools";
import type { ChatMessage } from "./openai-compatible";

const MAX_AGENT_LOOPS = 3;

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

export async function runAgent(opts: {
  provider: Parameters<typeof createChatCompletion>[0]["provider"];
  key: string;
  messages: ChatMessage[];
  userId: string | null;
  threadId: string | null;
  body: ReqBody;
  budget: { left: number };
  /** Streams the reply text as it is written; `reset` fires when a turn that
   *  streamed text goes on to call tools (that text was chatter, not the answer). */
  stream?: { onText: (delta: string) => void; onReset: () => void };
}) {
  const messages = [...opts.messages];
  const actions: unknown[] = [];
  const items: { ids: string[]; heading?: string }[] = [];
  let choices: string[] | undefined;
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
      ...(opts.stream ? { onText: opts.stream.onText } : {}),
    });
    latencyMs += completion.latencyMs;
    const reply = completion.message;
    messages.push(reply);
    if (!reply.tool_calls?.length) {
      return {
        text:
          reply.content?.trim() ||
          (items.length || choices
            ? "Here you go."
            : "I couldn't produce a useful answer. Try rephrasing that request."),
        actions,
        items,
        choices,
        latencyMs,
      };
    }
    opts.stream?.onReset();
    let allStaged = true;
    const iterationStart = messages.length;
    for (const call of reply.tool_calls) {
      try {
        const result = await executeDatebookTool(call.function.name, call.function.arguments, {
          userId: opts.userId,
          threadId: opts.threadId,
          body: opts.body,
        });
        if (result.action) actions.push(result.action);
        else allStaged = false;
        if (result.display?.items) items.push(result.display.items);
        if (result.display?.choices) choices = result.display.choices;
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
    // Did the staged adds keep every time, place and reminder the user gave?
    // One corrective round, spent from the same slot as malformed arguments.
    if (allStaged && actions.length && malformedRetries < 1) {
      const missing = findMissingDetails(
        opts.body.message,
        actions as StagedAdd[],
        opts.body.timeZone || "UTC",
      );
      if (missing.length) {
        malformedRetries += 1;
        // Nothing from this attempt is shown; the model is told, in place of
        // the "ok" it was about to read, exactly what was dropped.
        actions.length = 0;
        const error = JSON.stringify({
          ok: false,
          error: `Nothing was staged. ${correctiveMessage(missing)}`,
        });
        for (let i = iterationStart; i < messages.length; i += 1) {
          if (messages[i].role === "tool") messages[i] = { ...messages[i], content: error };
        }
        continue;
      }
    }
    // Every call only staged a confirmation card, so the model has nothing new to
    // reason about: skip the follow-up call (it would re-send the whole prompt) and
    // answer from the text it already wrote or the staged summaries.
    if (allStaged && actions.length) {
      return {
        text: reply.content?.trim() || confirmationText(actions),
        actions,
        items,
        choices,
        latencyMs,
      };
    }
  }
  throw new Error("Assistant exceeded the maximum tool-call loop count");
}
