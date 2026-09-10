"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, RotateCw, Sparkles, Trash2, X } from "lucide-react";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { askAssistant, type AssistantAction, type AssistantTurn } from "@/lib/ai-assistant";
import { maybePromptForReminders } from "@/lib/reminders";
import { remindersFromPresetIds } from "@/lib/reminder-defaults";
import { AssistantMarkdown } from "@/lib/markdown";
import { ViewportLayer } from "@/components/viewport-layer";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
  degraded?: boolean;
}

const WELCOME: Message = {
  role: "assistant",
  text: "Ask about your calendar — what's due, when you're free — or tell me to add, move, reschedule, complete, or delete something. You can paste a schedule straight in and I'll work out the dates.",
  suggestions: [
    "What's due this week?",
    "When am I free on Friday?",
    "Add gym at 6pm tomorrow",
    "What's my heaviest day?",
  ],
};

const ASSISTANT_SESSION_KEY = "datebook-assistant-session";

function loadSessionMessages(): Message[] {
  if (typeof sessionStorage === "undefined") return [WELCOME];
  try {
    const raw = sessionStorage.getItem(ASSISTANT_SESSION_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as Message[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export function AIDrawer() {
  const open = useUIStore((s) => s.aiDrawerOpen);
  const setOpen = useUIStore((s) => s.setAIDrawerOpen);
  const pendingMessage = useUIStore((s) => s.aiDrawerPendingMessage);
  const consumePendingMessage = useUIStore((s) => s.consumeAIDrawerPendingMessage);
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const defaultReminderPresetIds = useDatebookStore((s) => s.settings.defaultReminderPresetIds);
  const addItem = useDatebookStore((s) => s.addItem);
  const updateItem = useDatebookStore((s) => s.updateItem);
  const deleteItem = useDatebookStore((s) => s.deleteItem);

  const [messages, setMessages] = useState<Message[]>(loadSessionMessages);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [slow, setSlow] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  // `${messageIndex}:${actionIndex}` → outcome
  const [resolved, setResolved] = useState<Record<string, "applied" | "dismissed">>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  // Keep the sheet mounted through its exit animation, then drop it. The enter/
  // exit visuals are pure CSS keyframes (see globals.css) — framer's
  // AnimatePresence has been unreliable here and an invisible-but-mounted drawer
  // is worse than a plain one.
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresent(true);
      return;
    }
    // Hand focus back now rather than letting the field take it to the grave
    // 190ms later when the sheet unmounts. Tapping a button doesn't blur an
    // input on iOS, so without this the keyboard — and the viewport shift it
    // holds the page in — only starts unwinding once the sheet has already
    // gone, which is what left the tab bar hanging in mid-air afterwards.
    inputRef.current?.blur();
    const t = setTimeout(() => setPresent(false), 190);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    if (typeof sessionStorage === "undefined" || messages.length <= 1) return;
    try {
      sessionStorage.setItem(ASSISTANT_SESSION_KEY, JSON.stringify(messages.slice(-24)));
    } catch {
      /* quota / private mode */
    }
  }, [messages]);

  // "Still working…" nudge so a slow reply doesn't look frozen.
  useEffect(() => {
    if (!thinking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 9000);
    return () => clearTimeout(t);
  }, [thinking]);

  // The engine: whenever the last message is an unanswered user turn, send it.
  // Keeps sending decoupled from the click handlers, so a queued follow-up or a
  // retry just appends a user turn and this picks it up.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || inFlight.current) return;
    inFlight.current = true;
    setThinking(true);
    const history: AssistantTurn[] = messages
      .slice(1, -1) // drop the static welcome and the pending user turn
      .filter((m) => m.text)
      .map((m) => ({ role: m.role, text: m.text }));
    askAssistant(last.text, history, { items, categories, clock24h, weekStartsOn })
      .then((res) =>
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: res.text,
            suggestions: res.suggestions,
            actions: res.actions,
            degraded: res.degraded,
          },
        ])
      )
      .catch(() =>
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: "Something went wrong reaching the assistant.",
            degraded: true,
          },
        ])
      )
      .finally(() => {
        inFlight.current = false;
        setThinking(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Flush a queued follow-up once the current reply lands.
  useEffect(() => {
    if (thinking || inFlight.current || !queued) return;
    const q = queued;
    setQueued(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
  }, [thinking, queued]);

  // A message handed over from the quick-add bar: send it once the drawer opens.
  useEffect(() => {
    if (!open || !pendingMessage) return;
    const msg = consumePendingMessage();
    if (msg) ask(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingMessage]);

  function ask(query: string) {
    const text = query.trim();
    if (!text) return;
    setInput("");
    if (inFlight.current || thinking) {
      setQueued(text);
      return;
    }
    setMessages((m) => [...m, { role: "user", text }]);
  }

  function retry(mi: number) {
    if (inFlight.current) return;
    const userMsg = messages[mi - 1];
    if (userMsg?.role !== "user") return;
    // Drop the failed reply (and anything after); the engine effect re-sends the
    // user turn that's now last.
    setMessages((m) => m.slice(0, mi));
  }

  function applyAction(mi: number, ai: number) {
    const action = messages[mi]?.actions?.[ai];
    if (!action || resolved[`${mi}:${ai}`]) return;
    if (action.kind === "create") {
      let draft = action.draft;
      if (!draft.reminders?.length) {
        const defaults = remindersFromPresetIds(defaultReminderPresetIds, reminderPresets);
        if (defaults.length) {
          draft = { ...draft, reminders: defaults };
        }
      }
      addItem(draft);
      if (draft.reminders?.length) {
        void maybePromptForReminders(() => useDatebookStore.getState().items);
      }
    } else if (action.kind === "update") {
      updateItem(action.itemId, action.patch);
    } else if (action.kind === "delete") {
      deleteItem(action.itemId);
    }
    setResolved((r) => ({ ...r, [`${mi}:${ai}`]: "applied" }));
  }

  function dismissAction(mi: number, ai: number) {
    setResolved((r) => ({ ...r, [`${mi}:${ai}`]: "dismissed" }));
  }

  useLockBodyScroll(present);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined" || !window.matchMedia("(min-width: 768px)").matches) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  if (!present) return null;

  return (
    <ViewportLayer className="z-50">
      <div
        onClick={() => setOpen(false)}
        className={cn("assistant-overlay overlay-scrim absolute inset-0", open ? "is-open" : "is-closed")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-title"
        className={cn(
          "assistant-panel absolute flex flex-col overflow-hidden border border-line bg-surface",
          // Phone-only: compact bottom sheet. Desktop geometry lives in
          // globals.css so max-width / inset from the sheet can't leak up.
          "max-md:inset-x-3 max-md:bottom-[max(0.9rem,calc(env(safe-area-inset-bottom)+0.65rem))] max-md:mx-auto max-md:h-[70dvh] max-md:max-h-[min(560px,calc(100%-env(safe-area-inset-top)-1.25rem))] max-md:w-auto max-md:max-w-[400px] max-md:rounded-[22px] max-md:shadow-[0_16px_40px_-12px_rgb(0_0_0_/_0.28)]",
          open ? "is-open" : "is-closed"
        )}
      >
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3 md:gap-3 md:px-6 md:py-4">
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent md:flex">
              <Sparkles className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p id="assistant-title" className="text-[13.5px] font-semibold text-ink md:text-[16px]">
                Assistant
              </p>
              <p className="hidden text-[12.5px] text-ink-faint md:block">Ask about your calendar</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-4 py-3.5 md:space-y-4 md:px-6 md:py-6">
            {messages.map((m, mi) => (
              <motion.div
                key={mi}
                initial={{ opacity: 0, y: 8, x: m.role === "user" ? 8 : -8 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                transition={motionTokens.spring}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] whitespace-pre-line rounded-lg rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-accent-ink md:max-w-[78%] md:rounded-2xl md:rounded-br-md md:px-4 md:py-2.5 md:text-[14px]"
                      : "max-w-[92%] space-y-2 md:max-w-[88%] md:space-y-2.5"
                  }
                >
                  {m.role === "assistant" ? (
                    <AssistantMarkdown text={m.text} className="md:text-[14.5px] md:leading-[1.55]" />
                  ) : (
                    m.text
                  )}

                  {m.degraded && (
                    <button
                      onClick={() => retry(mi)}
                      className="flex items-center gap-1 text-[11px] font-medium text-ink-faint transition-colors hover:text-accent"
                    >
                      <RotateCw className="h-3 w-3" strokeWidth={2} />
                      Offline answer · retry
                    </button>
                  )}

                  {m.actions?.map((action, ai) => {
                    const state = resolved[`${mi}:${ai}`];
                    return (
                      <div key={ai} className="rounded-lg border border-line bg-surface-sunken p-2.5 md:rounded-xl md:p-3">
                        <p className="text-[12px] text-ink-soft md:text-[13px]">{action.summary}</p>
                        {state === "applied" ? (
                          <motion.p
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={motionTokens.springSnappy}
                            className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-good"
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Done
                          </motion.p>
                        ) : state === "dismissed" ? (
                          <p className="mt-1.5 text-[12px] text-ink-faint">Dismissed</p>
                        ) : (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => dismissAction(mi, ai)}
                              className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => applyAction(mi, ai)}
                              className={cn(
                                "flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:opacity-90",
                                action.kind === "delete" ? "bg-warn" : "bg-accent"
                              )}
                            >
                              {action.kind === "delete" && <Trash2 className="h-3 w-3" strokeWidth={2} />}
                              {actionVerb(action)}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {m.suggestions && m.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 md:grid md:grid-cols-2 md:gap-2">
                      {m.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => ask(s)}
                          className="rounded-full border border-line px-3 py-1.5 text-left text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent md:rounded-xl md:px-3.5 md:py-2.5 md:text-[13px]"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            ))}

            <AnimatePresence initial={false}>
              {thinking && (
                <motion.div
                  key="thinking"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
                  className="flex items-center gap-2 px-1"
                >
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="thinking-dot h-1.5 w-1.5 rounded-full bg-ink-faint"
                        style={{ animationDelay: `${i * 0.14}s` }}
                      />
                    ))}
                  </div>
                  {slow && <span className="text-[11px] text-ink-faint">Still working…</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="shrink-0 border-t border-line p-2.5 md:p-5">
            {queued && (
              <p className="mb-1.5 px-1 text-[11px] text-ink-faint">
                Queued — sending after this reply
              </p>
            )}
            <div className="flex items-center gap-2 md:rounded-xl md:border md:border-line md:bg-surface-sunken/70 md:px-3 md:py-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask(input)}
                onFocus={() => {
                  // Once the keyboard has opened and the drawer resettled, pin the
                  // conversation to the latest message so it isn't left scrolled up
                  // behind the shorter viewport.
                  setTimeout(() => {
                    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
                  }, 300);
                }}
                placeholder="Ask or tell me to change something…"
                enterKeyHint="send"
                className="min-h-11 min-w-0 flex-1 rounded-lg bg-surface-sunken px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none md:min-h-10 md:rounded-none md:bg-transparent md:px-1 md:text-[14px]"
              />
              <button
                onClick={() => ask(input)}
                disabled={!input.trim()}
                aria-label="Send"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-[opacity,transform] hover:opacity-90 disabled:opacity-30 md:h-10 md:w-10"
              >
                <motion.span
                  // The arrow lifts as soon as the field has something to send,
                  // so the button stops looking permanently disabled.
                  initial={false}
                  animate={{ y: input.trim() ? -1 : 0 }}
                  transition={motionTokens.springSnappy}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
                </motion.span>
              </button>
            </div>
          </div>
      </div>
    </ViewportLayer>
  );
}

function actionVerb(a: AssistantAction): string {
  if (a.kind === "create") return "Add";
  if (a.kind === "delete") return "Delete";
  const p = a.patch;
  if (p.status === "done") return "Complete";
  if (p.status === "todo" || p.status === "doing") return "Reopen";
  if (p.at || "endAt" in p) return "Reschedule";
  if (p.title) return "Rename";
  if (p.categoryId) return "Recategorize";
  return "Update";
}
