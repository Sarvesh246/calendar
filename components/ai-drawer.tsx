"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Sparkles, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { answerQuery, type AssistantAction, type AssistantResponse } from "@/lib/ai-assistant";
import { motion as motionTokens } from "@/lib/motion";

interface Message {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  action?: AssistantAction;
}

const WELCOME: Message = {
  role: "assistant",
  text: "Ask me anything about your schedule, or tell me to add, move, rename, complete, or delete something.",
  suggestions: ["What's due this week?", "What's next?", "Add homework due Friday at 5pm"],
};

export function AIDrawer() {
  const open = useUIStore((s) => s.aiDrawerOpen);
  const setOpen = useUIStore((s) => s.setAIDrawerOpen);
  const items = useDatebookStore((s) => s.items);
  const categories = useDatebookStore((s) => s.categories);
  const addItem = useDatebookStore((s) => s.addItem);
  const updateItem = useDatebookStore((s) => s.updateItem);
  const deleteItem = useDatebookStore((s) => s.deleteItem);

  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  function ask(query: string) {
    if (!query.trim()) return;
    setMessages((m) => [...m, { role: "user", text: query }]);
    setInput("");
    setThinking(true);
    window.setTimeout(() => {
      const response: AssistantResponse = answerQuery(query, { items, categories });
      setMessages((m) => [...m, { role: "assistant", ...response }]);
      setThinking(false);
    }, 500);
  }

  function confirmAction(action: AssistantAction) {
    let confirmation: string;
    switch (action.kind) {
      case "create": {
        addItem(action.draft);
        confirmation = `Added "${action.draft.title}".`;
        break;
      }
      case "reschedule": {
        updateItem(action.itemId, { at: action.newAt });
        confirmation = `Done — "${action.itemTitle}" moved.`;
        break;
      }
      case "rename": {
        updateItem(action.itemId, { title: action.newTitle });
        confirmation = `Renamed to "${action.newTitle}".`;
        break;
      }
      case "status": {
        updateItem(action.itemId, { status: action.newStatus });
        confirmation = `"${action.itemTitle}" updated.`;
        break;
      }
      case "delete": {
        deleteItem(action.itemId);
        confirmation = `Deleted "${action.itemTitle}".`;
        break;
      }
    }
    setMessages((m) => [...m, { role: "assistant", text: confirmation }]);
  }

  function dismissAction() {
    setMessages((m) => [...m, { role: "assistant", text: "No changes made." }]);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
          className="glass fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex h-[70vh] max-h-[560px] w-[92vw] max-w-[380px] flex-col overflow-hidden rounded-xl"
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

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3.5">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-lg bg-accent px-3 py-2 text-[13px] text-accent-ink"
                      : "max-w-[92%] space-y-2"
                  }
                >
                  <p className={m.role === "assistant" ? "text-[13px] text-ink" : ""}>{m.text}</p>

                  {m.action && (
                    <div className="rounded-lg border border-line bg-surface-sunken p-2.5">
                      <p className="text-[12px] text-ink-soft">{m.action.preview}</p>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={dismissAction}
                          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => confirmAction(m.action!)}
                          className={
                            m.action.kind === "delete"
                              ? "rounded-md bg-warn px-2.5 py-1 text-[12px] font-medium text-white hover:opacity-90"
                              : "rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:opacity-90"
                          }
                        >
                          {m.action.confirmLabel}
                        </button>
                      </div>
                    </div>
                  )}

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
                  <motion.span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full bg-ink-faint"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
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
              placeholder="Ask anything…"
              className="min-w-0 flex-1 rounded-lg bg-surface-sunken px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              onClick={() => ask(input)}
              disabled={!input.trim()}
              aria-label="Send"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
