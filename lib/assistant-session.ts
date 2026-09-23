"use client";

import { create } from "zustand";
import { askAssistant, type AssistantAction, type AssistantTurn } from "./ai-assistant";
import { maybePromptForReminders } from "./reminders";
import { reminderContext } from "./store-selectors";
import { remindersFromPresetIds } from "./reminder-defaults";
import { useDatebookStore } from "./store";
import { useAssistantModelStore } from "./assistant-models";
import { authHeaders } from "./auth-headers";
import type { Item } from "./types";

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

function itemFromServer(row: Record<string, unknown>): Item {
  return {
    id: String(row.id),
    categoryId: typeof row.category_id === "string" ? row.category_id : "",
    type: row.type as Item["type"],
    title: String(row.title),
    at: String(row.at),
    createdAt: String(row.created_at || new Date().toISOString()),
    ...(typeof row.description === "string" ? { description: row.description } : {}),
    ...(typeof row.location === "string" ? { location: row.location } : {}),
    ...(typeof row.end_at === "string" ? { endAt: row.end_at } : {}),
    ...(row.all_day ? { allDay: true } : {}),
    ...(typeof row.status === "string" ? { status: row.status as Item["status"] } : {}),
    ...(typeof row.completed_at === "string" ? { completedAt: row.completed_at } : {}),
    ...(typeof row.status_at === "string" ? { statusAt: row.status_at } : {}),
    ...(Array.isArray(row.reminders) && row.reminders.length ? { reminders: row.reminders as Item["reminders"] } : {}),
    ...(typeof row.updated_at === "string" ? { updatedAt: row.updated_at } : {}),
  };
}

async function confirmServerAction(serverActionId: string) {
  const response = await fetch("/api/assistant/confirm", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ confirmationId: serverActionId }),
  });
  const result = (await response.json()) as { item?: Record<string, unknown>; deletedId?: string; error?: string };
  if (!response.ok || result.error) throw new Error(result.error || "Could not apply this change");
  useDatebookStore.setState((state) => ({
    items: result.item
      ? [...state.items.filter((item) => item.id !== result.item!.id), itemFromServer(result.item)]
      : result.deletedId
        ? state.items.filter((item) => item.id !== result.deletedId)
        : state.items,
  }));
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
    const modelId = useAssistantModelStore.getState().selectedId;
    askAssistant(last.text, history, {
      items,
      categories,
      clock24h: settings.clock24h,
      weekStartsOn: settings.weekStartsOn,
      modelId,
      conversationId: conversationId(),
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
              providerLabel: res.providerLabel,
              fallbackNotice: res.fallbackNotice,
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
      if (action.serverActionId) {
        void confirmServerAction(action.serverActionId)
          .then(() => get().resolveAction(mi, ai, "applied"))
          .catch((error) =>
            set((state) => ({
              messages: [
                ...state.messages,
                { role: "assistant", text: error instanceof Error ? error.message : "Could not apply this change." },
              ],
            }))
          );
        return;
      }
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
