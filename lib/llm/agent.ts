import {
  correctiveMessage,
  findMissingDetails,
  type StagedAdd,
} from "@/lib/assistant-completeness";
import type { AssistantReqBody as ReqBody } from "@/lib/assistant-actions";
import { createChatCompletion } from "./router";
import { DATEBOOK_TOOLS, executeDatebookTool, MalformedToolArgumentsError } from "./tools";
import type { ChatMessage } from "./openai-compatible";

export class AssistantInterpretationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantInterpretationError";
  }
}

const MAX_AGENT_LOOPS = 5;

const MUTATION_TOOLS = new Set([
  "bulk_update",
  "bulk_shift",
  "bulk_delete",
  "revise_pending",
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
  let detailRetries = 0;
  let previousDetails: { actions: unknown[]; missing: string[] } | undefined;
  for (let loop = 0; loop < MAX_AGENT_LOOPS; loop += 1) {
    if (opts.budget.left <= 0) {
      if (previousDetails)
        return {
          text: `Please check these cards before confirming: ${previousDetails.missing.join(", ")} may be missing or incorrect.`,
          actions: previousDetails.actions,
          items,
          choices,
          latencyMs,
        };
      throw new AssistantInterpretationError("Assistant model-call budget exhausted");
    }
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
      if (previousDetails)
        return {
          text: `Please check these cards before confirming: ${previousDetails.missing.join(", ")} may be missing or incorrect.`,
          actions: previousDetails.actions,
          items,
          choices,
          latencyMs,
        };
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
    // The message classifier is only a hint. A read-looking request can still
    // lead the model to call a write tool, so enforce the boundary here too.
    if (
      opts.provider.model &&
      !/120b/i.test(opts.provider.model) &&
      reply.tool_calls.some((call) => MUTATION_TOOLS.has(call.function.name))
    ) {
      throw new AssistantInterpretationError("Mutation requires a 120B model");
    }
    let allStaged = true;
    const iterationStart = messages.length;
    const actionStart = actions.length;
    let hadMalformed = false;
    for (const call of reply.tool_calls) {
      try {
        const result = await executeDatebookTool(call.function.name, call.function.arguments, {
          userId: opts.userId,
          threadId: opts.threadId,
          body: opts.body,
        });
        if (result.action) actions.push(result.action);
        else if (result.actions?.length) actions.push(...result.actions);
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
        if (!(error instanceof MalformedToolArgumentsError)) throw error;
        if (malformedRetries >= 1) {
          return {
            text: previousDetails
              ? `Please check these cards before confirming: ${previousDetails.missing.join(", ")} may be missing or incorrect.`
              : "I couldn't interpret that change reliably. Please clarify the date, time, or other details and try again.",
            actions: previousDetails?.actions ?? [],
            items,
            choices,
            latencyMs,
          };
        }
        malformedRetries += 1;
        hadMalformed = true;
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
    if (hadMalformed && actions.length > actionStart) {
      actions.splice(actionStart);
      for (let i = iterationStart; i < messages.length; i += 1) {
        if (
          messages[i].role === "tool" &&
          String(messages[i].content).includes("awaiting_confirmation")
        )
          messages[i] = {
            ...messages[i],
            content: JSON.stringify({
              ok: false,
              error:
                "No cards from this batch will be shown. Reissue the full mutation batch with corrected arguments.",
            }),
          };
      }
    }
    // Did the staged adds keep every time, place and reminder the user gave?
    // A separate corrective round for details.
    if (allStaged && actions.length) {
      const missing = findMissingDetails(
        opts.body.message,
        actions as StagedAdd[],
        opts.body.timeZone || "UTC",
        new Date(opts.body.now),
        opts.body.categories,
      );
      if (missing.length) {
        if (detailRetries >= 1) {
          return {
            text: `Please check these cards before confirming: ${missing.join(", ")} may be missing or incorrect.`,
            actions,
            items,
            choices,
            latencyMs,
          };
        }
        detailRetries += 1;
        previousDetails = { actions: [...actions], missing };
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
  return {
    text: previousDetails
      ? `Please check these cards before confirming: ${previousDetails.missing.join(", ")} may be missing or incorrect.`
      : "I couldn't finish interpreting that request. Please try a simpler phrasing.",
    actions: previousDetails?.actions ?? [],
    items,
    choices,
    latencyMs,
  };
}
