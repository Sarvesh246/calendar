"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Bell, Plus, Tag, X } from "lucide-react";
import { useDatebookStore } from "@/lib/store";
import { useUIStore } from "@/lib/ui-store";
import { parseQuickAdd, type ParsedQuickAdd } from "@/lib/quick-add-parser";
import { looksLikeBulkPaste, parseBulk, toNewItem, type BulkDraft } from "@/lib/bulk-parse";
import { BulkAddPreview } from "@/components/bulk-add-preview";
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

type Phase = "idle" | "preview" | "ask" | "bulk";

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
  const [bulk, setBulk] = useState<{ drafts: BulkDraft[]; skipped: string[] } | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // The field is a single line, so a multi-line paste would arrive with its
  // newlines flattened — and with them, any hope of telling the rows apart.
  // The original text is kept here instead.
  const rawRef = useRef<string>("");

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

  /** Try the pasted-schedule path. Returns true when it took over. */
  function tryBulk(raw: string): boolean {
    if (!looksLikeBulkPaste(raw)) return false;
    const result = parseBulk(raw, categories);
    if (result.drafts.length < 2) return false;
    setBulk(result);
    setPicked(result.drafts.map(() => true));
    setPhase("bulk");
    return true;
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || phase !== "idle") return;
    if (tryBulk(rawRef.current || trimmed)) return;
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

  function confirmBulk() {
    if (!bulk) return;
    const fallback = categories[0]?.id;
    for (let i = 0; i < bulk.drafts.length; i += 1) {
      if (picked[i]) addItem(toNewItem(bulk.drafts[i], fallback));
    }
    reset();
  }

  function reset() {
    setText("");
    setParsed(null);
    setBulk(null);
    setPicked([]);
    setPhase("idle");
    rawRef.current = "";
    setDateKey(null);
    setTimeHint(null);
    closeQuickAdd();
  }

  const ready = Boolean(text.trim()) && phase === "idle";
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
          "focus-within-ring flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5",
          "transition-[border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
          // The bar itself is the focus indicator for the field inside it, so it
          // has to be unmistakable rather than a half-tinted hairline.
          focused && "border-accent"
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
        <div className="flex min-w-0 flex-1 items-center">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              rawRef.current = "";
              setText(e.target.value);
            }}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text");
              if (!pasted.includes("\n")) return;
              // A pasted block is the whole input, not an insertion — showing it
              // squashed onto one line would be a lie about what we parsed.
              e.preventDefault();
              rawRef.current = pasted;
              setText(pasted.replace(/\s+/g, " ").trim().slice(0, 200));
              tryBulk(pasted);
            }}
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
        </div>
        {!embedded && (
          <Button variant="tertiary" size="iconSm" onClick={reset} aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2} />
          </Button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!ready}
          aria-label="Add"
          className={cn(
            "press-none flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            "transition-[background-color,color] duration-[var(--motion-standard)]",
            ready
              ? "bg-accent text-accent-ink hover:opacity-90"
              : "bg-surface-sunken text-ink-faint"
          )}
        >
          <motion.span
            initial={false}
            animate={{ scale: ready ? 1 : 0.86 }}
            transition={motionTokens.springSnappy}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
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
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-lg border border-line bg-surface p-4"
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
                Ask assistant instead
              </Button>
            </div>
          </motion.div>
        )}
        {phase === "bulk" && bulk && (
          <BulkAddPreview
            drafts={bulk.drafts}
            skipped={bulk.skipped}
            selected={picked}
            onToggle={(i) => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))}
            onCancel={reset}
            onConfirm={confirmBulk}
            onAskAI={() => {
              askAI(
                `Add these to my calendar. Keep each one on the date shown:\n\n${rawRef.current || text}`
              );
              reset();
            }}
          />
        )}
        {phase === "preview" && parsed && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
            transition={motionTokens.spring}
            style={{ transformOrigin: "top center" }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 max-h-[min(60dvh,calc(var(--visible-height,100dvh)-8rem))] overflow-y-auto rounded-lg border border-line bg-surface p-4"
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
