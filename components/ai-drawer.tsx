"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Sparkles, Trash2, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { askAssistant, type AssistantAction, type AssistantTurn } from "@/lib/ai-assistant";
import { nanoid } from "@/lib/nanoid";
import { maybePromptForReminders } from "@/lib/reminders";
import { ViewportLayer } from "@/components/viewport-layer";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  actions?: AssistantAction[];
}

const WELCOME: Message = {
  role: "assistant",
  text: "Ask me anything about your calendar — what's due, when you're free, your busiest day — or tell me to add, move, reschedule, complete, or delete something.",
  suggestions: ["What's on today?", "What's due this week?", "Add gym at 6pm tomorrow"],
};

export function AIDrawer() {
  const open = useUIStore((s) => s.aiDrawerOpen);
  const setOpen = useUIStore((s) => s.setAIDrawerOpen);
  const pendingMessage = useUIStore((s) => s.aiDrawerPendingMessage);
  const consumePendingMessage = useUIStore((s) => s.consumeAIDrawerPendingMessage);
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const defaultReminderPresetIds = useDatebookStore((s) => s.settings.defaultReminderPresetIds);
  const addItem = useDatebookStore((s) => s.addItem);
  const updateItem = useDatebookStore((s) => s.updateItem);
  const deleteItem = useDatebookStore((s) => s.deleteItem);

  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  // `${messageIndex}:${actionIndex}` → outcome
  const [resolved, setResolved] = useState<Record<string, "applied" | "dismissed">>({});
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const t = setTimeout(() => setPresent(false), 190);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  // A message handed over from the quick-add bar: send it once the drawer opens.
  useEffect(() => {
    if (!open || !pendingMessage) return;
    const msg = consumePendingMessage();
    if (msg) void ask(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingMessage]);

  async function ask(query: string) {
    const text = query.trim();
    if (!text || thinking) return;
    const history: AssistantTurn[] = messages
      .filter((m) => m.text)
      .map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);
    try {
      const res = await askAssistant(text, history, { items, categories, clock24h });
      setMessages((m) => [
        ...m,
        { role: "assistant", text: res.text, suggestions: res.suggestions, actions: res.actions },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: "Something went wrong reaching the assistant — try again in a moment." },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function applyAction(mi: number, ai: number) {
    const action = messages[mi]?.actions?.[ai];
    if (!action || resolved[`${mi}:${ai}`]) return;
    if (action.kind === "create") {
      let draft = action.draft;
      if (!draft.reminders?.length) {
        const preset = reminderPresets.find((p) => defaultReminderPresetIds.includes(p.id));
        if (preset) {
          draft = {
            ...draft,
            reminders: [
              { id: nanoid(), itemId: "", offsetMinutes: preset.offsetMinutes, label: preset.label },
            ],
          };
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

  if (!present) return null;

  return (
    <ViewportLayer className="z-50">
      <div
        onClick={() => setOpen(false)}
        className={cn(
          "absolute inset-0 bg-black/35 backdrop-blur-[2px]",
          open
            ? "animate-[overlay-in_200ms_ease-out]"
            : "animate-[overlay-out_180ms_ease-in_forwards]"
        )}
      />
      <div
        style={{
          // Anchored to the bottom of the ViewportLayer (which tracks the
          // visible area above the keyboard) — the sheet always sits just above
          // the keyboard with its top clear of the notch.
          maxHeight: "min(560px, calc(100% - env(safe-area-inset-top) - 1.25rem))",
          height: "70dvh",
        }}
        className={cn(
          "glass absolute inset-x-3 bottom-3 mx-auto flex w-auto max-w-[400px] flex-col overflow-hidden rounded-2xl",
          open
            ? "animate-[sheet-in_220ms_var(--ease-standard)]"
            : "animate-[sheet-out_180ms_ease-in_forwards]"
        )}
      >
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} />
            <span className="text-[13.5px] font-semibold text-ink">Datebook Assistant</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="ml-auto rounded-md p-1 text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
            {messages.map((m, mi) => (
              <div key={mi} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-lg bg-accent px-3 py-2 text-[13px] text-accent-ink"
                      : "max-w-[92%] space-y-2"
                  }
                >
                  <p
                    className={
                      m.role === "assistant"
                        ? "whitespace-pre-line text-[13px] leading-relaxed text-ink"
                        : ""
                    }
                  >
                    {m.text}
                  </p>

                  {m.actions?.map((action, ai) => {
                    const state = resolved[`${mi}:${ai}`];
                    return (
                      <div key={ai} className="rounded-lg border border-line bg-surface-sunken p-2.5">
                        <p className="text-[12px] text-ink-soft">{action.summary}</p>
                        {state === "applied" ? (
                          <p className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-good">
                            <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Done
                          </p>
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
                    <div className="flex flex-wrap gap-1.5">
                      {m.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => ask(s)}
                          className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:border-accent hover:text-accent"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {thinking && (
              <div className="flex items-center gap-1 px-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-duration:1s]"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-line p-2.5">
            <input
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
              className="min-w-0 flex-1 rounded-lg bg-surface-sunken px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              onClick={() => ask(input)}
              disabled={!input.trim() || thinking}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
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
