"use client";

import { create } from "zustand";
import {
  askAssistant,
  toAssistantSlimItem,
  type AssistantAction,
  type AssistantTurn,
} from "./ai-assistant";
import { maybePromptForReminders } from "./reminders";
import { reminderContext } from "./store-selectors";
import { remindersFromPresetIds } from "./reminder-defaults";
import { useDatebookStore } from "./store";
import { useUIStore } from "./ui-store";
import { normalizeActions, resolveDraftClass } from "./assistant-actions";
import { actionFor, type MutationToolName } from "./assistant-tool-actions";
import { useAssistantModelStore } from "./assistant-models";
import { authHeaders } from "./auth-headers";
import { supersedeOpenCards, staleReason, type ActionOutcome } from "./assistant-staleness";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
  degraded?: boolean;
  providerLabel?: string;
  fallbackNotice?: string;
  /** Outcome per action index. Lives on the message so it's saved with the
   *  session and travels with it when a retry trims the list. */
  resolved?: Record<number, ActionOutcome>;
  /** When the reply landed (ms). Cards expire 30 minutes later, like the
   *  server's staged action does. */
  createdAt?: number;
}

export const WELCOME: AssistantMessage = {
  role: "assistant",
  text: "Ask about your calendar — what's due, when you're free — or tell me to add, move, reschedule, complete, or delete something. You can paste a schedule straight in and I'll work out the dates.",
  suggestions: [
    "What's due this week?",
    "When am I free on Friday?",
    "Add gym at 6pm tomorrow",
    "What's my heaviest day?",
  ],
};

const SESSION_KEY = "datebook-assistant-session";
const THREAD_KEY = "datebook-assistant-thread";

function conversationId() {
  if (typeof sessionStorage === "undefined") return undefined;
  let id = sessionStorage.getItem(THREAD_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(THREAD_KEY, id);
  }
  return id;
}

/**
 * Ask the server to confirm a staged action. It validates and claims it and
 * hands back the arguments — it writes nothing. The change itself is applied
 * here, through the same store actions the on-device engine uses, so
 * tombstones, sync, reminder scheduling, the save pill, widget refresh and Undo
 * all behave identically whichever engine staged the card.
 */
async function confirmServerAction(card: AssistantAction): Promise<AssistantAction> {
  const serverActionId = card.serverActionId;
  if (!serverActionId) throw new Error("Could not apply this change");
  const response = await fetch("/api/assistant/confirm", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ confirmationId: serverActionId }),
  });
  const result = (await response.json()) as {
    tool?: MutationToolName;
    arguments?: Record<string, unknown>;
    error?: string;
  };
  if (!response.ok || result.error || !result.tool || !result.arguments) {
    throw new Error(result.error || "Could not apply this change");
  }
  const { items, categories } = useDatebookStore.getState();
  const target = result.arguments.id
    ? items.find((item) => item.id === String(result.arguments!.id))
    : undefined;
  const [action] = normalizeActions(
    [actionFor(result.tool, result.arguments, target ? toAssistantSlimItem(target) : null)],
    {
      message: "",
      now: new Date().toISOString(),
      items: items.map(toAssistantSlimItem),
      categories,
    },
  );
  if (!action) throw new Error("This item no longer exists");
  // The class on the card is the one the user saw and may have changed; the
  // server's copy only says what the model asked for.
  if (action.kind === "create" && card.kind === "create") {
    action.draft = { ...action.draft, categoryId: card.draft.categoryId };
  }
  return withResolvedClasses([action], categories)![0];
}

/** Apply one action through the store's own actions. */
function applyToStore(action: AssistantAction) {
  const store = useDatebookStore.getState();
  if (action.kind === "create") {
    let draft = action.draft;
    if (draft.reminders === undefined) {
      const defaults = remindersFromPresetIds(
        store.settings.defaultReminderPresetIds,
        store.reminderPresets,
      );
      if (defaults.length) draft = { ...draft, reminders: defaults };
    }
    store.addItem(draft);
    if (draft.reminders?.length) void maybePromptForReminders(reminderContext);
  } else if (action.kind === "update") {
    store.updateItem(action.itemId, action.patch);
  } else {
    store.deleteItem(action.itemId);
  }
}

function loadSessionMessages(): AssistantMessage[] {
  if (typeof sessionStorage === "undefined") return [WELCOME];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as AssistantMessage[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

interface AssistantSessionState {
  messages: AssistantMessage[];
  thinking: boolean;
  /** A reply is taking long enough to say so. */
  slow: boolean;
  /** A follow-up typed while a reply was still coming. */
  queued: string | null;
  ask: (query: string) => void;
  retry: (messageIndex: number) => void;
  applyAction: (messageIndex: number, actionIndex: number) => void;
  resolveAction: (messageIndex: number, actionIndex: number, outcome: ActionOutcome) => void;
  /** Change the class a staged "add" will be filed under. */
  setActionClass: (messageIndex: number, actionIndex: number, categoryId: string) => void;
  reset: () => void;
}

/** The class implied by where the chat was opened: a single filtered class. */
function contextClassId(): string | null {
  const filter = useUIStore.getState().categoryFilter;
  return filter && filter.length === 1 ? filter[0] : null;
}

/** Give every staged "add" the class it will actually land in, so the card can
 *  name it and the apply step cannot disagree. */
function withResolvedClasses(
  actions: AssistantAction[] | undefined,
  categories: { id: string }[],
): AssistantAction[] | undefined {
  if (!actions) return actions;
  const context = contextClassId();
  return actions.map((a) =>
    a.kind === "create"
      ? { ...a, draft: { ...a.draft, categoryId: resolveDraftClass(a.draft, categories, context) } }
      : a,
  );
}

let inFlight = false;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * One conversation, whichever surface shows it. The modal sheet and the panel
 * docked beside the calendar both read this store, so switching between them
 * keeps the thread — and a reply that lands while you switch still arrives.
 */
export const useAssistantSession = create<AssistantSessionState>((set, get) => {
  /** Send the last message if it is an unanswered user turn. */
  function run() {
    const { messages } = get();
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || inFlight) return;
    inFlight = true;
    set({ thinking: true, slow: false });
    clearTimeout(slowTimer);
    slowTimer = setTimeout(() => set({ slow: true }), 9000);
    const history: AssistantTurn[] = messages
      .slice(0, -1)
      .filter((m) => m.text && m.text !== WELCOME.text)
      .map((m) => ({ role: m.role, text: m.text }));
    const { items, categories, settings } = useDatebookStore.getState();
    const modelId = useAssistantModelStore.getState().selectedId;
    askAssistant(last.text, history, {
      items,
      categories,
      clock24h: settings.clock24h,
      weekStartsOn: settings.weekStartsOn,
      modelId,
      conversationId: conversationId(),
    })
      .then((res) => {
        res = { ...res, actions: withResolvedClasses(res.actions, categories) };
        set((s) => ({
          messages: [
            ...supersedeOpenCards(s.messages, res.actions),
            {
              role: "assistant",
              text: res.text,
              suggestions: res.suggestions,
              actions: res.actions,
              degraded: res.degraded,
              providerLabel: res.providerLabel,
              fallbackNotice: res.fallbackNotice,
              ...(res.actions?.length ? { createdAt: Date.now() } : {}),
            },
          ],
        }));
      })
      .catch(() =>
        set((s) => ({
          messages: [
            ...s.messages,
            {
              role: "assistant",
              text: "Something went wrong reaching the assistant.",
              degraded: true,
            },
          ],
        })),
      )
      .finally(() => {
        inFlight = false;
        clearTimeout(slowTimer);
        set({ thinking: false, slow: false });
        const queued = get().queued;
        if (queued) {
          set((s) => ({ queued: null, messages: [...s.messages, { role: "user", text: queued }] }));
          run();
        }
      });
  }

  return {
    messages: loadSessionMessages(),
    thinking: false,
    slow: false,
    queued: null,

    ask: (query) => {
      const text = query.trim();
      if (!text) return;
      if (inFlight) {
        set({ queued: text });
        return;
      }
      set((s) => ({ messages: [...s.messages, { role: "user", text }] }));
      run();
    },

    retry: (mi) => {
      if (inFlight) return;
      const { messages } = get();
      if (messages[mi - 1]?.role !== "user") return;
      // Drop the failed reply (and anything after); the user turn is last again.
      set({ messages: messages.slice(0, mi) });
      run();
    },

    applyAction: (mi, ai) => {
      const message = get().messages[mi];
      const action = message?.actions?.[ai];
      if (!action || message.resolved?.[ai]) return;
      // The card may have outlived what it is about. Say so rather than
      // report "Done" for a change that cannot happen.
      const live = useDatebookStore.getState().items;
      const stale = staleReason(
        action,
        message.createdAt,
        (id) => live.some((item) => item.id === id),
        Date.now(),
      );
      if (stale) {
        get().resolveAction(mi, ai, stale);
        return;
      }
      if (action.serverActionId) {
        void confirmServerAction(action)
          .then((confirmed) => {
            applyToStore(confirmed);
            get().resolveAction(mi, ai, "applied");
          })
          .catch((error) => {
            const text = error instanceof Error ? error.message : "Could not apply this change.";
            // An item that vanished is the card's own state, not a new message.
            if (/no longer exists/i.test(text)) get().resolveAction(mi, ai, "stale");
            else
              set((state) => ({
                messages: [...state.messages, { role: "assistant", text }],
              }));
          });
        return;
      }
      applyToStore(action);
      get().resolveAction(mi, ai, "applied");
    },

    setActionClass: (mi, ai, categoryId) =>
      set((s) => ({
        messages: s.messages.map((msg, i) =>
          i === mi && msg.actions
            ? {
                ...msg,
                actions: msg.actions.map((a, j) =>
                  j === ai && a.kind === "create" ? { ...a, draft: { ...a.draft, categoryId } } : a,
                ),
              }
            : msg,
        ),
      })),

    resolveAction: (mi, ai, outcome) =>
      set((s) => ({
        messages: s.messages.map((msg, i) =>
          i === mi ? { ...msg, resolved: { ...msg.resolved, [ai]: outcome } } : msg,
        ),
      })),

    reset: () => {
      if (inFlight) return;
      set({ messages: [WELCOME], queued: null });
      try {
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(THREAD_KEY);
      } catch {
        /* private mode */
      }
    },
  };
});

useAssistantSession.subscribe((state, prev) => {
  if (state.messages === prev.messages || state.messages.length <= 1) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.messages.slice(-24)));
  } catch {
    /* quota / private mode */
  }
});
