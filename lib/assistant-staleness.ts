import type { AssistantAction } from "./ai-assistant";

/**
 * A card the user is looking at can outlive the thing it was about: the item
 * got deleted by a later card, the user asked again and a newer card replaced
 * it, or it simply sat there longer than the server keeps a staged change.
 * Tapping such a card must never report "Done" for a change that did not
 * happen.
 */

/** Matches the server's `expires_at` on a staged action. */
export const ACTION_TTL_MS = 30 * 60 * 1000;

export type ActionOutcome = "applied" | "dismissed" | "stale" | "superseded" | "expired";

export type OpenOutcomes = Record<number, ActionOutcome> | undefined;

/** The item an update/delete card is about; creates have none. */
export function actionTargetId(action: AssistantAction): string | null {
  return action.kind === "create" ? null : action.itemId;
}

/** Why an unresolved card can no longer be applied, or null if it still can. */
export function staleReason(
  action: AssistantAction,
  createdAt: number | undefined,
  itemExists: (id: string) => boolean,
  now: number,
): "stale" | "expired" | null {
  if (createdAt !== undefined && now - createdAt > ACTION_TTL_MS) return "expired";
  const target = actionTargetId(action);
  if (target && !itemExists(target)) return "stale";
  return null;
}

export const OUTCOME_COPY: Record<Exclude<ActionOutcome, "applied" | "dismissed">, string> = {
  stale: "This item no longer exists",
  superseded: "Replaced by a newer suggestion",
  expired: "Expired — ask again",
};

interface HasActions {
  actions?: AssistantAction[];
  resolved?: Record<number, ActionOutcome>;
}

/**
 * A new reply that targets an item already named by an open card replaces that
 * card: two live buttons for the same item would let the older one overwrite
 * the newer.
 */
export function supersedeOpenCards<M extends HasActions>(
  messages: M[],
  incoming: AssistantAction[] | undefined,
): M[] {
  const targets = new Set(
    (incoming ?? []).map(actionTargetId).filter((id): id is string => Boolean(id)),
  );
  if (targets.size === 0) return messages;
  return messages.map((msg) => {
    if (!msg.actions?.length) return msg;
    let resolved = msg.resolved;
    msg.actions.forEach((action, i) => {
      const target = actionTargetId(action);
      if (target && targets.has(target) && !resolved?.[i]) {
        resolved = { ...resolved, [i]: "superseded" };
      }
    });
    return resolved === msg.resolved ? msg : { ...msg, resolved };
  });
}
