"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, PanelRight, PictureInPicture2, RotateCw, SquarePen, Sparkles, Trash2, X } from "lucide-react";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { useUIStore } from "@/lib/ui-store";
import { clearDraft, readDraft, writeDraft } from "@/lib/drafts";
import { useKeepFieldVisible } from "@/lib/use-keep-field-visible";
import { useWorkspacePrefs } from "@/lib/workspace-prefs";
import { useMediaQuery } from "@/lib/use-media-query";
import { DOCK_MEDIA_QUERY } from "@/lib/assistant-dock";
import { navigateTab } from "@/lib/tab-nav";
import { useAssistantSession } from "@/lib/assistant-session";
import type { AssistantAction } from "@/lib/ai-assistant";
import { AssistantMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * The assistant conversation itself — header, thread, composer. The modal
 * sheet wraps it in an overlay; the calendar's side pane shows it docked, at
 * a narrower width, so it can be read while you click through dates.
 */
export function AssistantConversation({
  variant,
  active,
  onClose,
}: {
  variant: "modal" | "docked";
  /** Visible and meant to be talked to — gates focus and pending messages. */
  active: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const docked = variant === "docked";
  const messages = useAssistantSession((s) => s.messages);
  const thinking = useAssistantSession((s) => s.thinking);
  const slow = useAssistantSession((s) => s.slow);
  const queued = useAssistantSession((s) => s.queued);
  const ask = useAssistantSession((s) => s.ask);
  const retry = useAssistantSession((s) => s.retry);
  const applyAction = useAssistantSession((s) => s.applyAction);
  const resolveAction = useAssistantSession((s) => s.resolveAction);
  const reset = useAssistantSession((s) => s.reset);
  const pendingMessage = useUIStore((s) => s.aiDrawerPendingMessage);
  const canDock = useMediaQuery(DOCK_MEDIA_QUERY);
  // A question you were half-way through typing when the drawer was dismissed
  // is worth exactly as much as one you finished — keep it.
  const [input, setInput] = useState(() => readDraft("assistant"));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useKeepFieldVisible(composerRef, active && !docked);

  useEffect(() => {
    writeDraft("assistant", input);
  }, [input]);

  useEffect(() => {
    if (!active) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: prefersReducedMotion() ? "instant" : "smooth",
    });
  }, [messages, thinking, active]);

  // A message handed over from quick add or search: send it once we're showing.
  useEffect(() => {
    if (!active || !pendingMessage) return;
    const msg = useUIStore.getState().consumeAIDrawerPendingMessage();
    if (msg) ask(msg);
  }, [active, pendingMessage, ask]);

  useEffect(() => {
    if (!active) {
      // Hand focus back now rather than letting the field take it to the grave
      // when the sheet unmounts. Tapping a button doesn't blur an input on iOS,
      // so without this the keyboard — and the viewport shift it holds the page
      // in — only starts unwinding once the sheet has already gone.
      inputRef.current?.blur();
      return;
    }
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(id);
  }, [active]);

  function send(text: string) {
    if (!text.trim()) return;
    setInput("");
    // Sent is not interrupted — the words are in the thread now.
    clearDraft("assistant");
    ask(text);
  }

  function dockBesideCalendar() {
    const prefs = useWorkspacePrefs.getState();
    prefs.setAssistantDocked(true);
    prefs.setPaneTab("assistant");
    prefs.setPaneCollapsed(false);
    useUIStore.getState().setAIDrawerOpen(false);
    navigateTab(router, "/calendar");
  }

  function popOut() {
    useWorkspacePrefs.getState().setAssistantDocked(false);
    useUIStore.getState().setAIDrawerOpen(true);
  }

  const headerButton =
    "flex h-9 w-9 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink";

  return (
    <>
      {docked ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
          <p className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">Ask about your calendar</p>
          <button type="button" onClick={reset} disabled={thinking} aria-label="New conversation" title="New conversation" className={cn(headerButton, "disabled:opacity-40")}>
            <SquarePen className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button type="button" onClick={popOut} aria-label="Pop out assistant" title="Pop out" className={headerButton}>
            <PictureInPicture2 className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      ) : (
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
          <div className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={reset} disabled={thinking} aria-label="New conversation" title="New conversation" className={cn(headerButton, "hidden disabled:opacity-40 md:flex")}>
              <SquarePen className="h-4 w-4" strokeWidth={1.9} />
            </button>
            {canDock && (
              <button
                type="button"
                onClick={dockBesideCalendar}
                aria-label="Dock beside calendar"
                title="Dock beside calendar"
                className={headerButton}
              >
                <PanelRight className="h-4 w-4" strokeWidth={1.9} />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Close assistant" className={headerButton}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-y-contain px-4 py-3.5",
          !docked && "md:space-y-4 md:px-6 md:py-6"
        )}
      >
        {messages.map((m, mi) => {
          const newest = mi === messages.length - 1;
          const inner = (
            <div
              className={
                m.role === "user"
                  ? cn(
                      "max-w-[85%] whitespace-pre-line rounded-lg rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-relaxed text-accent-ink",
                      !docked && "md:max-w-[78%] md:rounded-2xl md:rounded-br-md md:px-4 md:py-2.5 md:text-[14px]"
                    )
                  : cn("max-w-[92%] space-y-2", !docked && "md:max-w-[88%] md:space-y-2.5")
              }
            >
              {m.role === "assistant" ? (
                <AssistantMarkdown text={m.text} className={docked ? "text-[13.5px] leading-[1.5]" : "md:text-[14.5px] md:leading-[1.55]"} />
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
                const state = m.resolved?.[ai];
                const facts = actionFacts(action);
                return (
                  <div key={ai} className={cn("rounded-lg border border-line bg-surface-sunken p-2.5", !docked && "md:rounded-xl md:p-3")}>
                    <p className={cn("text-[12px] text-ink-soft", !docked && "md:text-[13px]")}>{action.summary}</p>
                    {facts && (
                      <p className={cn("mt-0.5 text-[11px] text-ink-faint", !docked && "md:text-[12px]")}>
                        {facts}
                      </p>
                    )}
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
                          onClick={() => resolveAction(mi, ai, "dismissed")}
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
                <div className={cn("flex flex-wrap gap-1.5", !docked && "md:grid md:grid-cols-2 md:gap-2")}>
                  {m.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className={cn(
                        "rounded-full border border-line px-3 py-1.5 text-left text-[12px] text-ink-soft transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent",
                        !docked && "text-[11.5px] md:rounded-xl md:px-3.5 md:py-2.5 md:text-[13px]"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
          const rowClass = m.role === "user" ? "flex justify-end" : "flex justify-start";
          if (!newest) {
            return (
              <div key={mi} className={rowClass}>
                {inner}
              </div>
            );
          }
          return (
            <motion.div
              key={mi}
              initial={{ opacity: 0, y: 8, x: m.role === "user" ? 8 : -8 }}
              animate={{ opacity: 1, y: 0, x: 0 }}
              transition={motionTokens.spring}
              className={rowClass}
            >
              {inner}
            </motion.div>
          );
        })}

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

      <div className={cn("shrink-0 border-t border-line p-2.5", !docked && "md:p-5")}>
        {queued && (
          <p className="mb-1.5 px-1 text-[11px] text-ink-faint">Queued — sending after this reply</p>
        )}
        <div
          ref={composerRef}
          // Marks the field and Send as one unit, so the keyboard never covers
          // the button you need to finish with.
          data-field-group=""
          className={cn(
            "focus-within-ring flex items-center gap-2 rounded-xl border border-line bg-surface-sunken/70 px-2.5 py-1.5 transition-[border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)] focus-within:border-accent",
            !docked && "md:px-3 md:py-2"
          )}
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) send(input);
            }}
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
            className={cn(
              "min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none",
              docked ? "min-h-9 px-1" : "min-h-11 px-1 md:min-h-10 md:text-[14px]"
            )}
          />
          <button
            data-primary-action=""
            onClick={() => send(input)}
            disabled={!input.trim()}
            aria-label="Send"
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-[opacity,transform] hover:opacity-90 disabled:opacity-30",
              docked ? "h-8 w-8" : "h-11 w-11 md:h-10 md:w-10"
            )}
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
    </>
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

function actionFacts(a: AssistantAction): string | null {
  const bits: string[] = [];
  if (a.kind === "create") {
    if (a.draft.location) bits.push(a.draft.location);
    const labels = a.draft.reminders?.map((r) => r.label).filter(Boolean);
    if (labels?.length) bits.push(labels.join(", "));
  } else if (a.kind === "update") {
    if (a.patch.location) bits.push(a.patch.location);
    const labels = a.patch.reminders?.map((r) => r.label).filter(Boolean);
    if (labels?.length) bits.push(labels.join(", "));
  }
  return bits.length ? bits.join(" · ") : null;
}
