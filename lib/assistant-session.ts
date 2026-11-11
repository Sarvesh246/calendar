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
import { actionVerb, normalizeActions, resolveDraftClass, whenWord } from "./assistant-actions";
import { buildParts, historyText, type MessagePart } from "./assistant-parts";
import { actionFor, type MutationToolName } from "./assistant-tool-actions";
import { useAssistantModelStore } from "./assistant-models";
import { authHeaders } from "./auth-headers";
import { supersedeOpenCards, staleReason, type ActionOutcome } from "./assistant-staleness";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
  /** Why there is no real answer. Drawn as a sign-in card or a Retry, never
   *  as a guess. */
  error?: "signed-out" | "unreachable" | "busy";
  providerLabel?: string;
  fallbackNotice?: string;
  /** Outcome per action index. Lives on the message so it's saved with the
   *  session and travels with it when a retry trims the list. */
  resolved?: Record<number, ActionOutcome>;
  /** The reply as typed parts: text, item rows, cards, choices. Messages saved
   *  before parts existed have none and derive them from `text`/`actions`. */
  parts?: MessagePart[];
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

/** How to put back what an applied card changed. In memory only: an undo that
 *  outlived the page would be undoing something the user has long since moved on from. */
interface Undoable {
  label: string;
  undo: () => boolean;
}
const undoers = new Map<string, Undoable>();
let latestUndo: string | null = null;

const UNDO_PHRASE =
  /^(?:undo|undo (?:that|it|this|the last (?:one|change))|revert(?: that| it)?|take (?:that|it) back)[.!]?$/i;

/** "undo that": put back the most recent change this chat made. */
function undoLatest(): string {
  const key = latestUndo;
  const entry = key ? undoers.get(key) : undefined;
  if (!key || !entry) return "There's nothing to undo yet.";
  const [mi, ai] = key.split(":").map(Number);
  if (!entry.undo()) return "I can't undo that one any more.";
  undoers.delete(key);
  latestUndo = null;
  useAssistantSession.getState().resolveAction(mi, ai, "undone");
  return `Undid ${entry.label}.`;
}

/** Apply one action through the store's own actions, and say how to reverse it. */
function applyToStore(action: AssistantAction): Undoable {
  const store = useDatebookStore.getState();
  const label = `${actionVerb(action).toLowerCase()} “${
    action.kind === "create" ? action.draft.title : action.itemTitle
  }”`;
  if (action.kind === "create") {
    let draft = action.draft;
    if (draft.reminders === undefined) {
      const defaults = remindersFromPresetIds(
        store.settings.defaultReminderPresetIds,
        store.reminderPresets,
      );
      if (defaults.length) draft = { ...draft, reminders: defaults };
    }
    const created = store.addItem(draft);
    if (draft.reminders?.length) void maybePromptForReminders(reminderContext);
    return {
      label,
      undo: () => {
        const live = useDatebookStore.getState();
        if (created.repeatId) live.deleteSeries(created.repeatId);
        else live.deleteItem(created.id);
        return true;
      },
    };
  }
  if (action.kind === "update") {
    const before = store.items.find((item) => item.id === action.itemId);
    store.updateItem(action.itemId, action.patch);
    return {
      label,
      undo: () => {
        if (!before) return false;
        const revert: Record<string, unknown> = {};
        for (const key of Object.keys(action.patch)) {
          revert[key] = (before as unknown as Record<string, unknown>)[key];
        }
        useDatebookStore.getState().updateItem(action.itemId, revert as Partial<typeof before>);
        return true;
      },
    };
  }
  store.deleteItem(action.itemId);
  return {
    label,
    undo: () => {
      const live = useDatebookStore.getState();
      // The store's own Undo: it puts the item back and out-ranks the tombstone.
      if (!live.lastDeleted?.items.some((item) => item.id === action.itemId)) return false;
      live.restoreLastDeleted();
      return true;
    },
  };
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
  /** The reply so far, while it is being written. */
  streaming: string;
  /** Follow-ups typed while a reply was still coming, in order. Each is sent
   *  after the one before it, and each shows as a pending bubble. */
  queued: string[];
  ask: (query: string) => void;
  retry: (messageIndex: number) => void;
  applyAction: (messageIndex: number, actionIndex: number) => void;
  /** Put back what a card changed. */
  undoAction: (messageIndex: number, actionIndex: number) => void;
  resolveAction: (messageIndex: number, actionIndex: number, outcome: ActionOutcome) => void;
  /** Apply every card in a reply that is still open. */
  applyAll: (messageIndex: number) => void;
  /** Change the class a staged "add" will be filed under. */
  setActionClass: (messageIndex: number, actionIndex: number, categoryId: string) => void;
  reset: () => void;
}

/** One line per item for history: what the model needs to resolve "the second one". */
function describeItem(id: string): string | undefined {
  const { items, settings } = useDatebookStore.getState();
  const item = items.find((i) => i.id === id);
  if (!item) return undefined;
  return `${item.title} (${whenWord(item.at, { type: item.type, allDay: item.allDay, clock24h: settings.clock24h })})`;
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

/** An hour of silence and the next message starts a fresh conversation. */
const IDLE_NEW_CHAT_MS = 60 * 60 * 1000;
let lastActivity = Date.now();

/** Two follow-ups worth tapping, made in code from what was just answered. */
function followUps(res: { items?: unknown[]; actions?: unknown[]; text: string; error?: string }) {
  if (res.error || res.actions?.length) return undefined;
  if (res.items?.length || /\bdue\b|overdue/i.test(res.text)) {
    return ["What's overdue?", "What's due tomorrow?"];
  }
  return ["What's due this week?", "When am I free tomorrow?"];
}

/** Where the chat was opened from, so "move this to Friday" has a "this". */
function chatContext() {
  const ui = useUIStore.getState();
  const filter = ui.categoryFilter;
  return {
    ...(ui.calendarFocusDate ? { selectedDay: ui.calendarFocusDate } : {}),
    ...(ui.inspectorItemId ? { openItemId: ui.inspectorItemId } : {}),
    ...(filter && filter.length === 1 ? { activeClass: filter[0] } : {}),
  };
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
      .map((m) => ({ role: m.role, text: historyText(m, describeItem) }));
    const { items, categories, settings } = useDatebookStore.getState();
    const modelId = useAssistantModelStore.getState().selectedId;
    askAssistant(last.text, history, {
      items,
      categories,
      clock24h: settings.clock24h,
      weekStartsOn: settings.weekStartsOn,
      modelId,
      conversationId: conversationId(),
      context: chatContext(),
      onPartial: (text) => set({ streaming: text }),
    })
      .then((res) => {
        res = { ...res, actions: withResolvedClasses(res.actions, categories) };
        set((s) => ({
          messages: [
            ...supersedeOpenCards(s.messages, res.actions),
            {
              role: "assistant",
              text: res.text,
              suggestions: res.suggestions ?? followUps(res),
              actions: res.actions,
              parts: buildParts(res),
              ...(res.error ? { error: res.error } : {}),
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
              text: "I couldn't reach the assistant just now.",
              error: "unreachable" as const,
              parts: [
                {
                  type: "error" as const,
                  kind: "unreachable" as const,
                  text: "I couldn't reach the assistant just now.",
                },
              ],
            },
          ],
        })),
      )
      .finally(() => {
        inFlight = false;
        clearTimeout(slowTimer);
        set({ thinking: false, slow: false, streaming: "" });
        const [next, ...rest] = get().queued;
        if (next) {
          set((s) => ({ queued: rest, messages: [...s.messages, { role: "user", text: next }] }));
          run();
        }
      });
  }

  return {
    messages: loadSessionMessages(),
    thinking: false,
    slow: false,
    streaming: "",
    queued: [],

    ask: (query) => {
      const text = query.trim();
      if (!text) return;
      if (!inFlight && get().messages.length > 1 && Date.now() - lastActivity > IDLE_NEW_CHAT_MS) {
        get().reset();
      }
      lastActivity = Date.now();
      if (inFlight) {
        set((s) => ({ queued: [...s.queued, text] }));
        return;
      }
      // "undo that" is not a question for a model: put back the last change.
      if (UNDO_PHRASE.test(text)) {
        const note = undoLatest();
        set((s) => ({
          messages: [...s.messages, { role: "user", text }, { role: "assistant", text: note }],
        }));
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
            const done = applyToStore(confirmed);
            undoers.set(`${mi}:${ai}`, done);
            latestUndo = `${mi}:${ai}`;
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
      const done = applyToStore(action);
      undoers.set(`${mi}:${ai}`, done);
      latestUndo = `${mi}:${ai}`;
      get().resolveAction(mi, ai, "applied");
    },

    undoAction: (mi, ai) => {
      const entry = undoers.get(`${mi}:${ai}`);
      if (!entry || get().messages[mi]?.resolved?.[ai] !== "applied") return;
      if (entry.undo()) {
        undoers.delete(`${mi}:${ai}`);
        get().resolveAction(mi, ai, "undone");
      } else {
        set((state) => ({
          messages: [
            ...state.messages,
            { role: "assistant", text: "I can't undo that one any more." },
          ],
        }));
      }
    },

    applyAll: (mi) => {
      const message = get().messages[mi];
      message?.actions?.forEach((_, ai) => {
        if (!get().messages[mi]?.resolved?.[ai]) get().applyAction(mi, ai);
      });
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
      set({ messages: [WELCOME], queued: [] });
      undoers.clear();
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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state.messages.slice(-60)));
  } catch {
    /* quota / private mode */
  }
});
