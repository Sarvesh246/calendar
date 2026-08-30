"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Bell, Plus, Sparkles, Tag, X } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "preview" | "ask";

export function QuickAddBar({ embedded = false }: { embedded?: boolean }) {
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
  const askAI = useUIStore((s) => s.askAI);
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [focused, setFocused] = useState(false);
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
      setPhase("ask");
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

  function addAnyway() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const anchor = dateKey ? new Date(`${dateKey}T12:00:00`) : undefined;
    const result = parseQuickAdd(text, categories, {
      ...(anchor ? { anchor } : {}),
      ...(timeHint ? { hour: timeHint.hour, minute: timeHint.minute } : {}),
    });
    setParsed(result);
    setPhase("preview");
  }

  function reset() {
    setText("");
    setParsed(null);
    setPhase("idle");
    setDateKey(null);
    setTimeHint(null);
    closeQuickAdd();
  }

  const category = categories.find((c) => c.id === parsed?.categoryId);
  const whenLabel = parsed
    ? parsed.allDay
      ? `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · all day`
      : `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · ${formatTime(parsed.at.toISOString(), clock24h)}${parsed.endAt ? `–${formatTime(parsed.endAt.toISOString(), clock24h)}` : ""}`
    : "";

  return (
    <div className="relative w-full">
      <div
        className={cn(
          "glass flex items-center gap-2.5 rounded-xl px-4 py-3",
          "transition-[box-shadow,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
          focused && "border-accent/50 shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent),var(--shadow-lg)]"
        )}
      >
        <motion.span
          // The glyph tints and grows on focus — a small confirmation that the
          // app is listening, in the one place people type most.
          animate={{ scale: focused ? 1.12 : 1 }}
          transition={motionTokens.springSnappy}
          className={cn(
            "shrink-0 transition-colors duration-[var(--motion-standard)]",
            focused ? "text-accent" : "text-ink-faint"
          )}
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </motion.span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") reset();
          }}
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          placeholder={dateKey ? `Add something on ${dateKey}…` : "Assignment, class, or task…"}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
        />
        {!embedded && (
          <Button variant="tertiary" size="iconSm" onClick={reset} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2} />
          </Button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || phase !== "idle"}
          aria-label="Add"
          className="press-none flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity duration-[var(--motion-standard)] hover:opacity-90 disabled:opacity-30"
        >
          <motion.span
            initial={false}
            animate={{ scale: text.trim() && phase === "idle" ? 1 : 0.86 }}
            transition={motionTokens.springSnappy}
          >
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
          </motion.span>
        </button>
      </div>

      <AnimatePresence>
        {phase === "ask" && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
            className="glass absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-xl p-4"
          >
            <p className="text-[13px] text-ink-soft">This looks like a question, not something to add.</p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="tertiary" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button variant="secondary" size="sm" onClick={addAnyway}>
                Add as item
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  askAI(text.trim());
                  reset();
                }}
              >
                <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
                Ask AI instead
              </Button>
            </div>
          </motion.div>
        )}
        {phase === "preview" && parsed && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.spring}
            style={{ transformOrigin: "top center" }}
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
              <Button variant="tertiary" size="sm" onClick={reset}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirm} className={cn()}>
                Add
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
