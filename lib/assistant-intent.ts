/**
 * Light-weight "is this a question or a new item?" heuristics.
 *
 * These live apart from `ai-assistant.ts` on purpose: quick-add, the command
 * palette and mobile search need them on first load, and `ai-assistant.ts`
 * statically pulls in the multi-thousand-line local assistant. Keeping the
 * helpers here lets that whole graph load lazily, on first real use.
 */

/* Verbs that act on something already on the calendar — these belong to the
 * assistant (which resolves the target and proposes a change), not to quick-add
 * (which only ever creates a brand-new item). */
export const COMMAND_VERBS =
  /^(move|reschedule|push|bump|shift|delete|remove|cancel|clear|rename|retitle|mark|complete|finish|check off|reopen|un-?complete|undo)\b/i;

/* Openers that signal a question rather than a thing to remember. */
export const QUESTION_OPENERS =
  /^(what|whats|when|whens|where|wheres|which|who|why|how|do i|did i|have i|am i|are there|is there|will i|can you|could you|should i|show me|list|tell me|remind me what|how many|how much|when'?s)\b/i;

export const CREATE_VERBS = /^(add|create|schedule|new|set up|book|block off|remind me to|put)\b/i;

/**
 * Decide whether text typed into the quick-add bar is really a question or a
 * change request (→ hand to the assistant) rather than a new item to create.
 */
export function shouldAskAssistant(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.endsWith("?")) return true;
  if (QUESTION_OPENERS.test(t)) return true;
  if (COMMAND_VERBS.test(t)) return true;
  if (looksLikeRichCreate(t)) return true;
  return false;
}

/** Long or multi-part creates the local parser shouldn't silently guess at. */
export function looksLikeRichCreate(text: string): boolean {
  const t = text.trim();
  const reminderHits =
    t.match(/\b(?:remind(?:er|ers| me)|ping me|nudge me|don'?t forget)\b/gi)?.length ?? 0;
  const hasLocation = /\bat the\b|\bin the\b|\blocation\b|\bby the\b/i.test(t);
  const hasTime =
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\bat\s+\d{1,2}(?::\d{2})?\b|\b\d{1,2}:\d{2}\b/i.test(t);
  const multiReminder = reminderHits >= 2 || /\ba reminder\b[\s\S]+\ba reminder\b/i.test(t);
  return (
    multiReminder ||
    (reminderHits >= 1 && (hasLocation || hasTime)) ||
    (hasLocation && hasTime && t.length >= 50)
  );
}

/**
 * Skip the "is this a question?" card and send the sentence to the assistant.
 * True questions, calendar edits, and rich creates all belong there.
 */
export function shouldHandOffToAssistant(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (COMMAND_VERBS.test(t)) return true;
  if (QUESTION_OPENERS.test(t)) return true;
  if (looksLikeRichCreate(t)) return true;
  if (
    t.endsWith("?") &&
    (CREATE_VERBS.test(t) || /\b(add|create|schedule|what|when|where|how)\b/i.test(t))
  )
    return true;
  return false;
}
