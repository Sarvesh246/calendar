"use client";

import { useMediaQuery } from "@/lib/use-media-query";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
import { reminderContext } from "@/lib/store-selectors";
import { formatTime } from "@/lib/date-utils";
import { repeatLabel } from "@/lib/repeat";
import { format, isToday } from "date-fns";
import { motion as motionTokens } from "@/lib/motion";
import { haptic } from "@/lib/haptic";
import { clearDraft, readDraft, readJsonDraft, writeDraft, writeJsonDraft } from "@/lib/drafts";
import {
  onDay,
  reminderChipLabel,
  resolveComposer,
  type ComposerOverrides,
} from "@/lib/composer-fields";
import { ComposerChips } from "@/components/composer-chips";
import { readViewState } from "@/lib/view-state";
import { useResolvedPathname } from "@/lib/tab-nav";
import { useHasMounted } from "@/lib/use-has-mounted";
import { useKeepFieldVisible } from "@/lib/use-keep-field-visible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Phase = "idle" | "preview" | "ask" | "bulk";

/** Anything in storage is untrusted — an older build's shape, or a hand edit. */
function readComposerOverrides(): ComposerOverrides {
  const stored = readJsonDraft<Record<string, unknown>>(
    "quick-add-fields",
    (v): v is Record<string, unknown> => Boolean(v) && typeof v === "object"
  );
  if (!stored) return {};
  const next: ComposerOverrides = {};
  if (typeof stored.dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stored.dateKey)) {
    next.dateKey = stored.dateKey;
  }
  if (typeof stored.categoryId === "string") next.categoryId = stored.categoryId;
  if (typeof stored.reminderMinutes === "number" && Number.isFinite(stored.reminderMinutes)) {
    next.reminderMinutes = stored.reminderMinutes;
  }
  return next;
}

export function QuickAddBar({ embedded = false }: { embedded?: boolean }) {
  const mobile = useMediaQuery("(max-width: 767px)");
  // What you corrected by tapping a chip. Empty means "whatever the sentence,
  // the context and the defaults work out to".
  const [overrides, setOverrides] = useState<ComposerOverrides>(() => readComposerOverrides());
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
  const durationHint = useUIStore((s) => s.quickAddDurationMin);
  const askAI = useUIStore((s) => s.askAI);
  const categoryFilter = useUIStore((s) => s.categoryFilter);
  // "Adding within a class uses that class" — on a phone, working inside one
  // class *is* having filtered to it. Two filtered classes is not a context, it
  // is a shortlist, so only a single selection counts.
  const contextCategoryId = categoryFilter?.length === 1 ? categoryFilter[0] : null;

  /**
   * The day the calendar is showing, when that is where you are.
   *
   * "Add to this day" already passes a date, but the floating add button — the
   * one actually within thumb reach — went through the generic `openAdd`, which
   * knows nothing about the calendar. Tapping a Thursday and then tapping Add
   * offered you today, which is not what anyone means by that sequence.
   *
   * Resolved after mount rather than during render: the selected day lives in
   * `sessionStorage`, which the server cannot see, and a chip that disagreed
   * with the server's markup would fail hydration.
   */
  const pathname = useResolvedPathname();
  const mounted = useHasMounted();
  const calendarDayKey =
    mounted && pathname === "/calendar" ? readViewState().calendarSelected ?? null : null;
  const contextDateKey = dateKey ?? calendarDayKey;

  /** A span swept out on the week grid sizes an event the text didn't. */
  const withDuration = (r: ParsedQuickAdd): ParsedQuickAdd =>
    durationHint && r.type === "event" && !r.allDay && !r.endAt
      ? { ...r, endAt: new Date(r.at.getTime() + durationHint * 60_000) }
      : r;
  const closeQuickAdd = useUIStore((s) => s.closeQuickAdd);

  // Whatever was half-typed when the sheet was last dismissed. A phone
  // interrupts you constantly — a notification, a backgrounded tab, a mis-swipe
  // — and losing the sentence you were mid-way through is the most annoying
  // thing a small app can do.
  const [text, setText] = useState(() => readDraft("quick-add"));
  const [phase, setPhase] = useState<Phase>("idle");
  const [focused, setFocused] = useState(false);
  const [parsed, setParsed] = useState<ParsedQuickAdd | null>(null);
  const [bulk, setBulk] = useState<{ drafts: BulkDraft[]; skipped: string[] } | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useKeepFieldVisible(rootRef, mobile);
  // The field is a single line, so a multi-line paste would arrive with its
  // newlines flattened — and with them, any hope of telling the rows apart.
  // The original text is kept here instead.
  const rawRef = useRef<string>("");

  useEffect(() => {
    if (prefill === null) return;
    // An empty prefill means "open a blank composer", which is now the same
    // request as "open the composer" — so it must not wipe a draft the user is
    // coming back to finish. Only actual prefill text replaces what's there.
    if (prefill !== "") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText(prefill);
    }
    inputRef.current?.focus();
    setPrefill(null);
  }, [prefill, setPrefill]);

  useEffect(() => {
    if (dateKey) inputRef.current?.focus();
  }, [dateKey]);

  useEffect(() => {
    writeDraft("quick-add", text);
  }, [text]);

  useEffect(() => {
    // Strip the `undefined`s a reset leaves behind, so an emptied override set
    // is stored as "nothing" rather than as three explicit blanks.
    const stored = Object.fromEntries(
      Object.entries(overrides).filter(([, v]) => v !== undefined)
    );
    writeJsonDraft("quick-add-fields", stored);
  }, [overrides]);

  /**
   * What the chips are describing: the sentence as it stands right now, parsed
   * on every keystroke rather than only when you press Add.
   *
   * Deferred, because parsing on the keystroke itself put a regex pass between
   * the tap and the character appearing. The chips lagging the text by a frame
   * is invisible; the text lagging your thumb is not.
   */
  const deferredText = useDeferredValue(text);
  const liveParse = useMemo(() => {
    const trimmed = deferredText.trim();
    if (!trimmed) return null;
    const anchor = dateKey ? new Date(`${dateKey}T12:00:00`) : undefined;
    return withDuration(
      parseQuickAdd(deferredText, categories, {
        ...(anchor ? { anchor } : {}),
        ...(timeHint ? { hour: timeHint.hour, minute: timeHint.minute } : {}),
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredText, dateKey, timeHint, durationHint, categories]);

  const defaultReminderMinutes = useMemo(() => {
    const defaults = remindersFromPresetIds(defaultReminderPresetIds, reminderPresets);
    return defaults.length ? defaults[0].offsetMinutes : null;
  }, [defaultReminderPresetIds, reminderPresets]);

  const now = useMemo(() => new Date(), [dateKey, deferredText]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolved = useMemo(
    () =>
      resolveComposer(
        liveParse,
        {
          dateKey: contextDateKey,
          categoryId: contextCategoryId,
          defaultReminderMinutes,
          fallbackCategoryId: categories[0]?.id,
        },
        overrides
      ),
    [liveParse, contextDateKey, contextCategoryId, defaultReminderMinutes, overrides, categories]
  );

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
    // On a phone the chips have been showing the day, class and reminder the
    // whole time you were typing, so the preview card would be asking you to
    // confirm something you have been looking at. One tap adds.
    if (mobile) {
      commit(liveParse);
      return;
    }
    const anchor = dateKey ? new Date(`${dateKey}T12:00:00`) : undefined;
    const result = parseQuickAdd(text, categories, {
      ...(anchor ? { anchor } : {}),
      ...(timeHint ? { hour: timeHint.hour, minute: timeHint.minute } : {}),
    });
    setParsed(withDuration(result));
    setPhase("preview");
  }

  /**
   * Add the item the chips are describing.
   *
   * `source` is the parse to build on: the live one when saving straight from
   * the composer (phones), the frozen one behind the preview card (desktop).
   * Either way the chips win, because a chip is something you chose.
   */
  function commit(source: ParsedQuickAdd | null) {
    if (!source) return;
    const fields = resolveComposer(
      source,
      {
        dateKey: contextDateKey,
        categoryId: contextCategoryId,
        defaultReminderMinutes,
        fallbackCategoryId: categories[0]?.id,
      },
      overrides
    );

    const at = fields.date.value;
    // The end moves with the start, so correcting the day of a 2–3pm event
    // keeps it two hours long instead of running to yesterday's 3pm.
    const endAt = source.endAt ? onDay(source.endAt, at) : undefined;

    const minutes = fields.reminderMinutes.value;
    const reminders =
      minutes === null
        ? undefined
        : [
            {
              id: nanoid(),
              itemId: "",
              offsetMinutes: minutes,
              label:
                fields.reminderMinutes.source === "typed" && source.reminderLabel
                  ? source.reminderLabel
                  : reminderChipLabel(minutes),
            },
          ];

    addItem({
      title: source.title,
      type: source.type,
      // Whatever the chip said, including a deliberate "No class".
      categoryId: fields.categoryId.value ?? "",
      at: at.toISOString(),
      ...(endAt ? { endAt: endAt.toISOString() } : {}),
      ...(source.allDay ? { allDay: true } : {}),
      ...(source.repeat ? { repeat: source.repeat } : {}),
      status: source.type === "event" ? undefined : "todo",
      reminders,
    });
    if (reminders) void maybePromptForReminders(reminderContext);
    haptic("success");
    reset();
  }

  function confirm() {
    commit(parsed);
  }

  function addAnyway() {
    const trimmed = text.trim();
    if (!trimmed) return;
    const anchor = dateKey ? new Date(`${dateKey}T12:00:00`) : undefined;
    const result = parseQuickAdd(text, categories, {
      ...(anchor ? { anchor } : {}),
      ...(timeHint ? { hour: timeHint.hour, minute: timeHint.minute } : {}),
    });
    setParsed(withDuration(result));
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

  /**
   * Put the bar back to nothing.
   *
   * `keepDraft` is the difference between finishing and being interrupted:
   * cancelling out of a preview, or closing the sheet, leaves the words where
   * you can pick them back up; actually adding the item clears them, because
   * the thing you were writing now exists.
   */
  function reset({ keepDraft = false }: { keepDraft?: boolean } = {}) {
    setOverrides({});
    if (keepDraft) {
      // Only the parse is thrown away — the sentence stays.
      setParsed(null);
      setBulk(null);
      setPicked([]);
      setPhase("idle");
      setDateKey(null);
      setTimeHint(null);
      closeQuickAdd();
      return;
    }
    setText("");
    clearDraft("quick-add");
    clearDraft("quick-add-fields");
    setParsed(null);
    setBulk(null);
    setPicked([]);
    setPhase("idle");
    rawRef.current = "";
    setDateKey(null);
    setTimeHint(null);
    closeQuickAdd();
  }

  // " · 2:00 PM–3:30 PM" when the add came from a spot (or sweep) on the week.
  const hintStart =
    dateKey && timeHint
      ? new Date(`${dateKey}T${String(timeHint.hour).padStart(2, "0")}:${String(timeHint.minute).padStart(2, "0")}:00`)
      : null;
  const hintTimeLabel = hintStart
    ? ` · ${formatTime(hintStart.toISOString(), clock24h)}${
        durationHint
          ? `–${formatTime(new Date(hintStart.getTime() + durationHint * 60_000).toISOString(), clock24h)}`
          : ""
      }`
    : "";

  const ready = Boolean(text.trim()) && phase === "idle";
  const category = categories.find((c) => c.id === parsed?.categoryId);
  const whenLabel = parsed
    ? parsed.allDay
      ? `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · all day`
      : `${isToday(parsed.at) ? "Today" : format(parsed.at, "EEE, MMM d")} · ${formatTime(parsed.at.toISOString(), clock24h)}${parsed.endAt ? `–${formatTime(parsed.endAt.toISOString(), clock24h)}` : ""}`
    : "";

  return (
    <div
      ref={rootRef}
      className={cn("relative w-full", mobile && "mobile-quick-add rounded-xl bg-surface p-2")}
    >
      <div
        // Marks the field and its send button as one unit, so the keyboard
        // never covers the button you need to finish with.
        data-field-group=""
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
              setParsed(null);
              setPhase("idle");
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
              if (e.nativeEvent.isComposing) return;
              // Enter twice is type → check → add, without reaching for the mouse.
              if (e.key === "Enter") {
                if (phase === "preview") confirm();
                else submit();
              }
              if (e.key === "Escape") reset({ keepDraft: true });
            }}
            enterKeyHint="go"
            aria-label="New item"
            autoComplete="off"
            autoCorrect="off"
            placeholder={
              dateKey
                ? `Add to ${format(new Date(`${dateKey}T12:00:00`), "EEE, MMM d")}${hintTimeLabel}…`
                : "Assignment, class, or task…"
            }
            className="min-w-0 flex-1 bg-transparent text-[16px] md:text-[14px] text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
          />
        </div>
        {!embedded && (
          <Button
            variant="tertiary"
            size="iconSm"
            onClick={() => reset({ keepDraft: true })}
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </Button>
        )}
        <button
          type="button"
          data-primary-action=""
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

      {/* Phones only. On a desktop the preview card has room to lay the same
          three facts out in full, and there is no keyboard covering it. */}
      {mobile && phase === "idle" && (
        <ComposerChips
          resolved={resolved}
          overrides={overrides}
          onChange={(patch) => setOverrides((o) => ({ ...o, ...patch }))}
          categories={categories}
          now={now}
        />
      )}

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
              <Button variant="tertiary" size="sm" onClick={() => reset({ keepDraft: true })}>
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
            onCancel={() => reset({ keepDraft: true })}
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
              {!mobile && parsed.reminderLabel && (
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
              <Button variant="tertiary" size="sm" onClick={() => reset({ keepDraft: true })}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirm}>
                Add
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
