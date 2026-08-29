"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Bell, Sparkles, Tag } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { parseQuickAdd, type ParsedQuickAdd } from "@/lib/quick-add-parser";
import { shouldAskAssistant } from "@/lib/ai-assistant";
import { remindersFromPresetIds } from "@/lib/reminder-defaults";
import { nanoid } from "@/lib/nanoid";
import { maybePromptForReminders } from "@/lib/reminders";
import { formatTime } from "@/lib/date-utils";
import { repeatLabel } from "@/lib/repeat";
import { format, isToday } from "date-fns";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Phase = "idle" | "preview";

export function QuickAddBar() {
  const categories = useDatebookStore((s) => s.categories);
  const addItem = useDatebookStore((s) => s.addItem);
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
  const defaultReminderPresetIds = useDatebookStore((s) => s.settings.defaultReminderPresetIds);
  const reminderPresets = useDatebookStore((s) => s.reminderPresets);
  const prefill = useUIStore((s) => s.quickAddPrefill);
  const setPrefill = useUIStore((s) => s.setQuickAddPrefill);
  const dateKey = useUIStore((s) => s.quickAddDateKey);
  const setDateKey = useUIStore((s) => s.setQuickAddDateKey);
  const timeHint = useUIStore((s) => s.quickAddTime);
  const setTimeHint = useUIStore((s) => s.setQuickAddTime);
  const setAIDrawerOpen = useUIStore((s) => s.setAIDrawerOpen);
  const askAI = useUIStore((s) => s.askAI);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<ParsedQuickAdd | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prefill !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(prefill);
      inputRef.current?.focus();
      setPrefill(null);
    }
  }, [prefill, setPrefill]);

  useEffect(() => {
    if (dateKey) inputRef.current?.focus();
  }, [dateKey]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || phase !== "idle") return;
    if (shouldAskAssistant(trimmed)) {
      askAI(trimmed);
      reset();
      return;
    }
    const anchor = dateKey ? new Date(`${dateKey}T12:00:00`) : undefined;
    const result = parseQuickAdd(text, categories, {
      ...(anchor ? { anchor } : {}),
      ...(timeHint ? { hour: timeHint.hour, minute: timeHint.minute } : {}),
    });
    setParsed(result);
    setPhase("preview");
  }

  function confirm() {
    if (!parsed) return;
    const defaults = remindersFromPresetIds(defaultReminderPresetIds, reminderPresets);
    const reminders = parsed.reminderMinutesBefore
      ? [
          {
            id: nanoid(),
            itemId: "",
            offsetMinutes: parsed.reminderMinutesBefore,
            label: parsed.reminderLabel ?? "Reminder",
          },
        ]
      : defaults.length
        ? defaults
        : undefined;
    const willHaveReminder = Boolean(reminders?.length);
    addItem({
      title: parsed.title,
      type: parsed.type,
      categoryId: parsed.categoryId ?? categories[0]?.id,
      at: parsed.at.toISOString(),
      ...(parsed.endAt ? { endAt: parsed.endAt.toISOString() } : {}),
      ...(parsed.allDay ? { allDay: true } : {}),
      ...(parsed.repeat ? { repeat: parsed.repeat } : {}),
      status: parsed.type === "event" ? undefined : "todo",
      reminders,
    });
    if (willHaveReminder) void maybePromptForReminders(() => useDatebookStore.getState().items);
    reset();
  }

  function reset() {
    setText("");
    setParsed(null);
    setPhase("idle");
    setDateKey(null);
    setTimeHint(null);
  }

  const category = categories.find((c) => c.id === parsed?.categoryId);
  const whenLabel = parsed
    ? parsed.allDay
      ? `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · all day`
      : `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · ${formatTime(parsed.at.toISOString(), clock24h)}${parsed.endAt ? `–${formatTime(parsed.endAt.toISOString(), clock24h)}` : ""}`
    : "";

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
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          placeholder={dateKey ? `Add something on ${dateKey}…` : "Add or ask anything…"}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setAIDrawerOpen(true)}
          aria-label="Ask AI"
          className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink sm:px-2 sm:py-1"
        >
          <Sparkles className="h-3.5 w-3.5 sm:hidden" strokeWidth={1.9} />
          <span className="hidden sm:inline">Ask AI</span>
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || phase !== "idle"}
          aria-label="Add"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-30 sm:h-7 sm:w-7"
        >
          <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
        </button>
      </div>

      <AnimatePresence>
        {phase === "preview" && parsed && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[min(60dvh,calc(var(--visible-height,100dvh)-8rem))] overflow-y-auto rounded-xl p-4"
          >
            <p className="text-[15px] font-semibold text-ink">{parsed.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-[12px] text-ink-soft">
                {whenLabel}
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
              {parsed.repeat && (
                <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-[12px] text-ink-soft">
                  {repeatLabel(parsed.repeat)}
                </span>
              )}
            </div>
            <div className="mt-3.5 flex justify-end gap-2">
              <button
                onClick={reset}
                className="min-h-11 rounded-lg px-3.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-surface-sunken"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                className={cn(
                  "min-h-11 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-ink transition-opacity hover:opacity-90"
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
