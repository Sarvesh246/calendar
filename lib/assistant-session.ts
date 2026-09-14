"use client";

import { create } from "zustand";
import { askAssistant, type AssistantAction, type AssistantTurn } from "./ai-assistant";
import { maybePromptForReminders } from "./reminders";
import { reminderContext } from "./store-selectors";
import { remindersFromPresetIds } from "./reminder-defaults";
import { useDatebookStore } from "./store";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
  degraded?: boolean;
  /** Outcome per action index. Lives on the message so it's saved with the
   *  session and travels with it when a retry trims the list. */
  resolved?: Record<number, "applied" | "dismissed">;
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
  resolveAction: (messageIndex: number, actionIndex: number, outcome: "applied" | "dismissed") => void;
  reset: () => void;
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
    askAssistant(last.text, history, {
      items,
      categories,
      clock24h: settings.clock24h,
      weekStartsOn: settings.weekStartsOn,
    })
      .then((res) =>
        set((s) => ({
          messages: [
            ...s.messages,
            {
              role: "assistant",
              text: res.text,
              suggestions: res.suggestions,
              actions: res.actions,
              degraded: res.degraded,
            },
          ],
        }))
      )
      .catch(() =>
        set((s) => ({
          messages: [
            ...s.messages,
            { role: "assistant", text: "Something went wrong reaching the assistant.", degraded: true },
          ],
        }))
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
      const store = useDatebookStore.getState();
      if (action.kind === "create") {
        let draft = action.draft;
        if (draft.reminders === undefined) {
          const defaults = remindersFromPresetIds(store.settings.defaultReminderPresetIds, store.reminderPresets);
          if (defaults.length) draft = { ...draft, reminders: defaults };
        }
        store.addItem(draft);
        if (draft.reminders?.length) void maybePromptForReminders(reminderContext);
      } else if (action.kind === "update") {
        store.updateItem(action.itemId, action.patch);
      } else if (action.kind === "delete") {
        store.deleteItem(action.itemId);
      }
      get().resolveAction(mi, ai, "applied");
    },

    resolveAction: (mi, ai, outcome) =>
      set((s) => ({
        messages: s.messages.map((msg, i) =>
          i === mi ? { ...msg, resolved: { ...msg.resolved, [ai]: outcome } } : msg
        ),
      })),

    reset: () => {
      if (inFlight) return;
      set({ messages: [WELCOME], queued: null });
      try {
        sessionStorage.removeItem(SESSION_KEY);
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
