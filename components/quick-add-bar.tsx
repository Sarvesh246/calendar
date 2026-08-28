"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Bell, Check, Sparkles, Tag } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { parseQuickAdd, type ParsedQuickAdd } from "@/lib/quick-add-parser";
import { shouldAskAssistant } from "@/lib/ai-assistant";
import { nanoid } from "@/lib/nanoid";
import { maybePromptForReminders } from "@/lib/reminders";
import { formatTime } from "@/lib/date-utils";
import { format, isToday } from "date-fns";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Phase = "idle" | "parsing" | "preview";

const CHECKS = [
  { key: "date" as const, label: "Date found" },
  { key: "category" as const, label: "Category suggested" },
  { key: "reminder" as const, label: "Reminder found" },
];

export function QuickAddBar() {
  const categories = useDatebookStore((s) => s.categories);
  const addItem = useDatebookStore((s) => s.addItem);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const defaultReminderPresetIds = useDatebookStore((s) => s.settings.defaultReminderPresetIds);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const prefill = useUIStore((s) => s.quickAddPrefill);
  const setPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const askAI = useUIStore((s) => s.askAI);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<ParsedQuickAdd | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Reacts to an external trigger (command palette "New item") that needs an
    // imperative DOM focus alongside the state sync — not expressible via
    // useSyncExternalStore, so a plain effect is the right tool here.
    if (prefill !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(prefill);
      inputRef.current?.focus();
      setPrefill(null);
    }
  }, [prefill, setPrefill]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || phase !== "idle") return;
    // A question ("what's due friday?") or a change to something that already
    // exists ("move my essay to sunday") goes to the assistant; only a plain
    // new thing to remember flows through quick-add's parse-and-confirm.
    if (shouldAskAssistant(trimmed)) {
      askAI(trimmed);
      reset();
      return;
    }
    setPhase("parsing");
    window.setTimeout(() => {
      const result = parseQuickAdd(text, categories);
      setParsed(result);
      setPhase("preview");
    }, 550);
  }

  function confirm() {
    if (!parsed) return;
    const preset = reminderPresets.find((p) => defaultReminderPresetIds.includes(p.id));
    const willHaveReminder = Boolean(parsed.reminderMinutesBefore || preset);
    addItem({
      title: parsed.title,
      type: parsed.type,
      categoryId: parsed.categoryId ?? categories[0]?.id,
      at: parsed.at.toISOString(),
      status: parsed.type === "event" ? undefined : "todo",
      reminders: parsed.reminderMinutesBefore
        ? [
            {
              id: nanoid(),
              itemId: "",
              offsetMinutes: parsed.reminderMinutesBefore,
              label: parsed.reminderLabel ?? "Reminder",
            },
          ]
        : preset
        ? [{ id: nanoid(), itemId: "", offsetMinutes: preset.offsetMinutes, label: preset.label }]
        : undefined,
    });
    if (willHaveReminder) void maybePromptForReminders(() => useDatebookStore.getState().items);
    reset();
  }

  function reset() {
    setText("");
    setParsed(null);
    setPhase("idle");
  }

  const category = categories.find((c) => c.id === parsed?.categoryId);

  return (
    <div className="relative w-full">
      <div className="glass flex items-center gap-2.5 rounded-xl px-4 py-3">
        <Sparkles className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
        <input
          ref={inputRef}
          value={text}
          disabled={phase !== "idle"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add or ask anything…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        <button
          onClick={() => setAIDrawerOpen(true)}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          Ask AI
        </button>
        <button
          onClick={submit}
          disabled={!text.trim() || phase !== "idle"}
          aria-label="Add"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      <AnimatePresence>
        {phase === "parsing" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-xl p-4"
          >
            <p className="mb-2.5 text-[13px] text-ink-soft">Understanding…</p>
            <div className="flex flex-col gap-1.5">
              {CHECKS.map((c, i) => (
                <motion.div
                  key={c.key}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.14, duration: motionTokens.standard }}
                  className="flex items-center gap-2 text-[12.5px] text-ink-faint"
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                  {c.label}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {phase === "preview" && parsed && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-xl p-4"
          >
            <p className="text-[15px] font-semibold text-ink">{parsed.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-[12px] text-ink-soft">
                {isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} ·{" "}
                {formatTime(parsed.at.toISOString(), clock24h)}
              </span>
              {category && (
                <span
                  style={{ "--cat": category.color } as React.CSSProperties}
                  className="cat-surface flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]"
                >
                  <Tag className="h-3 w-3" strokeWidth={1.75} />
                  {category.name}
                </span>
              )}
              {parsed.reminderLabel && (
                <span className="flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-[12px] text-ink-soft">
                  <Bell className="h-3 w-3" strokeWidth={1.75} />
                  {parsed.reminderLabel}
                </span>
              )}
            </div>
            <div className="mt-3.5 flex justify-end gap-2">
              <button
                onClick={reset}
                className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                className={cn(
                  "rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90"
                )}
              >
                Add
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
