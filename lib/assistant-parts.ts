import { isUndated, isUndatedAt } from "./undated";

/**
 * A reply is a list of typed parts rather than one blob of markdown. Lists of
 * the user's own items are rows you can tap (formatted by the same code on
 * both engines), "which one?" questions are choices you tap instead of retype,
 * and the change-staging cards are parts too.
 *
 * `text` stays on the message as well, so a session saved before parts existed
 * still loads, and so history sent to the model has words to resolve "the
 * second one" against.
 */

export type MessagePart =
  | { type: "text"; text: string }
  /** The user's own items, rendered live from the store by id. */
  | { type: "items"; ids: string[]; heading?: string }
  /** A tap-to-answer question. Tapping sends the option as the user's message. */
  | { type: "choice"; options: string[] }
  | { type: "notice"; tone: "info" | "warn"; text: string }
  /** No real answer: signed out (offer sign-in) or unreachable/busy (offer Retry). */
  | { type: "error"; kind: "signed-out" | "unreachable" | "busy" | "interpretation"; text: string }
  /** A staged change; `index` points into the message's `actions`. */
  | { type: "action"; index: number };

export interface ItemsBlock {
  ids: string[];
  heading?: string;
}

export interface ReplyShape {
  text: string;
  items?: ItemsBlock[];
  choices?: string[];
  fallbackNotice?: string;
  actions?: unknown[];
  error?: "signed-out" | "unreachable" | "busy" | "interpretation";
}

const MAX_ROWS = 25;
const MAX_CHOICES = 4;

/** Keep only what is safe to render: strings, bounded, de-duplicated. */
export function cleanItemsBlocks(raw: unknown): ItemsBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ItemsBlock[] = [];
  for (const block of raw) {
    if (!block || typeof block !== "object") continue;
    const ids = (block as { ids?: unknown }).ids;
    if (!Array.isArray(ids)) continue;
    const clean = [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))];
    if (!clean.length) continue;
    const heading = (block as { heading?: unknown }).heading;
    out.push({
      ids: clean.slice(0, MAX_ROWS),
      ...(typeof heading === "string" && heading.trim()
        ? { heading: heading.trim().slice(0, 80) }
        : {}),
    });
  }
  return out.length ? out : undefined;
}

export function cleanChoices(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = [
    ...new Set(
      raw
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim().slice(0, 80))
        .filter(Boolean),
    ),
  ].slice(0, MAX_CHOICES);
  return out.length >= 2 ? out : undefined;
}

/** The parts of a fresh reply, in reading order. */
export function buildParts(reply: ReplyShape): MessagePart[] {
  const parts: MessagePart[] = [];
  if (reply.error) return [{ type: "error", kind: reply.error, text: reply.text }];
  if (reply.text.trim()) parts.push({ type: "text", text: reply.text });
  for (const block of reply.items ?? []) {
    parts.push({
      type: "items",
      ids: block.ids,
      ...(block.heading ? { heading: block.heading } : {}),
    });
  }
  if (reply.fallbackNotice)
    parts.push({ type: "notice", tone: "info", text: reply.fallbackNotice });
  reply.actions?.forEach((_, index) => parts.push({ type: "action", index }));
  if (reply.choices?.length) parts.push({ type: "choice", options: reply.choices });
  return parts;
}

/** Parts for any message: its own, or — for one saved before parts existed —
 *  the same thing derived from its fields. */
export function partsOf(message: {
  text: string;
  parts?: MessagePart[];
  actions?: unknown[];
  fallbackNotice?: string;
  error?: "signed-out" | "unreachable" | "busy" | "interpretation";
}): MessagePart[] {
  return message.parts ?? buildParts(message);
}

/**
 * What the model should see as this turn's text: the words plus, for rows the
 * UI drew, their titles — otherwise "move the second one" has nothing to refer
 * to.
 */
export function historyText(
  message: {
    text: string;
    parts?: MessagePart[];
    actions?: import("./ai-assistant").AssistantAction[];
    resolved?: Record<number, string>;
  },
  describe: (id: string) => string | undefined,
): string {
  const lines: string[] = [];
  for (const part of message.parts ?? []) {
    if (part.type !== "items") continue;
    for (const id of part.ids) {
      const line = describe(id);
      if (line) lines.push(`- ${line}`);
    }
  }
  for (const [index, action] of (message.actions ?? []).entries()) {
    const status = message.resolved?.[index] ?? "pending confirmation";
    const details =
      action.kind === "batch"
        ? { count: action.actions.length, summary: action.summary }
        : action.kind === "create"
          ? { ...action.draft, at: isUndated(action.draft) ? "no due date" : action.draft.at }
          : action.kind === "update"
            ? {
                itemId: action.itemId,
                title: action.itemTitle,
                patch: {
                  ...action.patch,
                  ...(isUndatedAt(action.patch.at) ? { at: "no due date" } : {}),
                },
              }
            : { itemId: action.itemId, title: action.itemTitle };
    lines.push(`- Card ${index + 1} (${status}): ${action.kind} ${JSON.stringify(details)}`);
  }
  return lines.length ? `${message.text}\n${lines.join("\n")}` : message.text;
}
