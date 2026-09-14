"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { addDays, format } from "date-fns";
import { Bell, CalendarDays, Tag } from "lucide-react";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import {
  classChipLabel,
  dayChipLabel,
  reminderChipLabel,
  REMINDER_CHOICES,
  type ComposerOverrides,
  type ResolvedComposer,
} from "@/lib/composer-fields";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/use-media-query";
import type { Category } from "@/lib/types";

/**
 * The three things about a new item you are most likely to want to correct,
 * shown while you type rather than after you commit.
 *
 * Each chip states what the item will actually get. Tap one and it opens a
 * short list of choices directly above it — never a modal, never a native date
 * roller that takes over the screen for what is usually "tomorrow". Everything
 * stays inside the composer, which stays above the keyboard, so correcting the
 * day costs one tap and never loses your place in the sentence.
 *
 * A chip whose value came from somewhere specific (the day you opened Add from,
 * the class you had filtered, a word you typed) is tinted, so "this already
 * knows where it's going" is visible without reading.
 */
export function ComposerChips({
  resolved,
  overrides,
  onChange,
  categories,
  now,
  reminderCount = 1,
}: {
  resolved: ResolvedComposer;
  overrides: ComposerOverrides;
  onChange: (patch: ComposerOverrides) => void;
  categories: Category[];
  now: Date;
  reminderCount?: number;
}) {
  const [open, setOpen] = useState<"day" | "class" | "reminder" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const mobilePanelId = useId();
  const mobile = useMediaQuery("(max-width: 767px)");
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    };
    // `pointerdown` rather than `click`: a tap that starts outside should close
    // the picker before the field underneath can take focus and shift the page.
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !mobile) return;
    let settleFrame = 0;
    const frame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        const panel = mobilePanelRef.current;
        panel?.scrollIntoView({ block: "nearest" });
        panel
          ?.querySelector<HTMLElement>('[aria-pressed="true"]')
          ?.scrollIntoView({ block: "nearest" });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
    };
  }, [mobile, open]);

  const dayChoices = [
    { key: format(now, "yyyy-MM-dd"), label: "Today" },
    { key: format(addDays(now, 1), "yyyy-MM-dd"), label: "Tomorrow" },
    { key: format(addDays(now, 2), "yyyy-MM-dd"), label: format(addDays(now, 2), "EEEE") },
    { key: format(addDays(now, 7), "yyyy-MM-dd"), label: "Next week" },
  ];
  const currentDayKey = format(resolved.date.value, "yyyy-MM-dd");
  const currentReminder = resolved.reminderMinutes.value;
  // A custom default (12 hours in the screenshots) still needs a selected row
  // when its chip opens. Otherwise every visible option looks like changing it.
  const reminderChoices =
    currentReminder !== null && !REMINDER_CHOICES.some((choice) => choice.minutes === currentReminder)
      ? [
          ...REMINDER_CHOICES,
          { minutes: currentReminder, label: reminderChipLabel(currentReminder) },
        ].sort((a, b) => a.minutes - b.minutes)
      : REMINDER_CHOICES;

  const dayPicker = (
    <Choices>
      {dayChoices.map((choice) => (
        <Choice
          key={choice.key}
          selected={choice.key === currentDayKey}
          onSelect={() => {
            onChange({ dateKey: choice.key });
            setOpen(null);
          }}
        >
          {choice.label}
        </Choice>
      ))}
      {/* The full picker, for the one time in ten it isn't this week. A
          native `date` input is the right control here: it is the one every
          phone already knows how to show above its own keyboard. */}
      <label className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-line px-2.5 text-[13px] text-ink-soft">
        Pick a date
        <input
          type="date"
          aria-label="Pick a date"
          value={currentDayKey}
          onChange={(e) => {
            if (!e.target.value) return;
            onChange({ dateKey: e.target.value });
            setOpen(null);
          }}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-ink focus:outline-none"
        />
      </label>
    </Choices>
  );

  const classPicker = (
    <Choices>
      <Choice
        selected={!resolved.categoryId.value}
        onSelect={() => {
          onChange({ categoryId: "" });
          setOpen(null);
        }}
      >
        No class
      </Choice>
      {categories
        .filter((c) => !c.archived)
        .map((cat) => (
          <Choice
            key={cat.id}
            dot={cat.color}
            selected={cat.id === resolved.categoryId.value}
            onSelect={() => {
              onChange({ categoryId: cat.id });
              setOpen(null);
            }}
          >
            {cat.name}
          </Choice>
        ))}
    </Choices>
  );

  const reminderPicker = (
    <Choices>
      {reminderChoices.map((choice) => (
        <Choice
          key={choice.minutes}
          selected={
            choice.minutes === 0
              ? resolved.reminderMinutes.value === null
              : choice.minutes === resolved.reminderMinutes.value
          }
          onSelect={() => {
            onChange({ reminderMinutes: choice.minutes });
            setOpen(null);
          }}
        >
          {choice.label}
        </Choice>
      ))}
    </Choices>
  );

  const activePicker = open === "day" ? dayPicker : open === "class" ? classPicker : reminderPicker;

  return (
    // Wraps rather than scrolls. A horizontal scroller would be tidier at three
    // chips and completely broken at any number, because `overflow` clips
    // absolutely-positioned descendants — the pickers were opening *behind* the
    // text field, unreachable, with only the sliver inside the row hittable.
    <div ref={rootRef} className="mt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          icon={<CalendarDays className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
          label={dayChipLabel(resolved.date.value, now)}
          detail="Day"
          specific={resolved.date.source !== "default"}
          open={open === "day"}
          onToggle={() => setOpen(open === "day" ? null : "day")}
          mobile={mobile}
          mobilePanelId={mobilePanelId}
        >
          {dayPicker}
        </Chip>

        <Chip
          icon={<Tag className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
          label={classChipLabel(resolved.categoryId.value, categories)}
          detail="Class"
          specific={resolved.categoryId.source !== "default" || Boolean(resolved.categoryId.value)}
          dot={categories.find((c) => c.id === resolved.categoryId.value)?.color}
          open={open === "class"}
          onToggle={() => setOpen(open === "class" ? null : "class")}
          mobile={mobile}
          mobilePanelId={mobilePanelId}
        >
          {classPicker}
        </Chip>

        <Chip
          icon={<Bell className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />}
          label={
            reminderCount > 1
              ? `${reminderCount} reminders`
              : reminderChipLabel(resolved.reminderMinutes.value)
          }
          detail="Reminder"
          specific={resolved.reminderMinutes.value !== null}
          open={open === "reminder"}
          onToggle={() => setOpen(open === "reminder" ? null : "reminder")}
          mobile={mobile}
          mobilePanelId={mobilePanelId}
        >
          {reminderPicker}
        </Chip>

        {/* Only shown once you have actually overridden something, so the row
            stays three chips wide in the common case. */}
        {(overrides.dateKey !== undefined ||
          overrides.categoryId !== undefined ||
          overrides.reminderMinutes !== undefined) && (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              onChange({ dateKey: undefined, categoryId: undefined, reminderMinutes: undefined });
              setOpen(null);
            }}
            className="press-none flex min-h-9 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium text-ink-faint"
          >
            Reset
          </button>
        )}
      </div>

      {/* On a phone this stays in the composer's own scroll flow. Opening a
          chip can therefore never put its choices above the visual viewport or
          under the keyboard, even on a short landscape screen. Desktop keeps
          the compact anchored popover. */}
      <AnimatePresence initial={false} mode="wait">
        {mobile && open && (
          <motion.div
            key={open}
            id={mobilePanelId}
            ref={mobilePanelRef}
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
            animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
            transition={reduced ? motionTokens.tweenStandard : motionTokens.springLayout}
            className="mt-2 overflow-hidden"
          >
            <div className="max-h-[clamp(7rem,calc(var(--visible-height,100dvh)-13rem),18rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]">
              {activePicker}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chip({
  icon,
  label,
  detail,
  specific,
  dot,
  open,
  onToggle,
  children,
  mobile,
  mobilePanelId,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  specific: boolean;
  dot?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  mobile: boolean;
  mobilePanelId: string;
}) {
  const panelId = useId();
  const reduced = prefersReducedMotion();
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          haptic("light");
          onToggle();
        }}
        aria-expanded={open}
        aria-controls={mobile ? mobilePanelId : panelId}
        // The visible text is a value ("Tomorrow"); which field it belongs to is
        // only carried by a 14px glyph, so the name has to say both.
        aria-label={`${detail}: ${label}. Change`}
        className={cn(
          "press-none flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-medium",
          "transition-colors duration-[var(--motion-standard)]",
          open
            ? "border-accent bg-accent-soft text-accent"
            : specific
              ? "border-line-strong bg-surface-sunken text-ink"
              : "border-line bg-surface text-ink-soft"
        )}
      >
        {dot ? (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        ) : (
          icon
        )}
        <span className="max-w-[10rem] truncate">{label}</span>
      </button>

      <AnimatePresence>
        {open && !mobile && (
          <motion.div
            id={panelId}
            // Opens *upward*: the composer sits on the keyboard, so anything
            // that opened downward would be behind it.
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={{
              opacity: 0,
              transition: { duration: motionTokens.exit, ease: motionTokens.easeIn },
            }}
            transition={motionTokens.springSnappy}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-[calc(100%+6px)] left-0 z-[60] max-h-[min(50dvh,18rem)] w-[13.5rem] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)]"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Choices({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>;
}

function Choice({
  children,
  selected,
  dot,
  onSelect,
}: {
  children: React.ReactNode;
  selected: boolean;
  dot?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic("light");
        onSelect();
      }}
      aria-pressed={selected}
      className={cn(
        "press-none flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-[13.5px]",
        "transition-colors duration-[var(--motion-standard)]",
        selected ? "bg-accent-soft font-medium text-accent" : "text-ink active:bg-surface-sunken"
      )}
    >
      {dot && (
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
