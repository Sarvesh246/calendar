"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft } from "lucide-react";
import { parseJumpTarget } from "@/lib/date-jump";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type JumpGranularity = "day" | "month";

const MONTHS = Array.from({ length: 12 }, (_, i) => format(new Date(2000, i, 1), "MMM"));

/**
 * The calendar's title doubles as a date picker: type a date ("Dec 12", "in 3
 * weeks") or pick a month and year. Getting to finals week or next semester is
 * one step instead of a string of next-month clicks.
 */
export function DateJump({
  anchor,
  open,
  onOpenChange,
  onJump,
  children,
}: {
  anchor: Date;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJump: (date: Date, granularity: JumpGranularity) => void;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresent(true);
      return;
    }
    // A timer also finishes when the tab host is hidden and no animation frame
    // arrives. Reopening cancels the pending removal and reverses the motion.
    const timer = window.setTimeout(() => setPresent(false), motionTokens.exit * 1000 + 30);
    return () => window.clearTimeout(timer);
  }, [open]);
  return (
    <div className="relative shrink-0 self-start sm:self-auto">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Jump to a date (D)"
        className="group -mx-1.5 flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-left transition-colors duration-[var(--motion-standard)] hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {children}
        <span className="hidden text-[12px] font-medium text-ink-faint sm:inline">Jump</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-ink-faint transition-transform duration-[var(--motion-standard)] group-hover:text-ink-soft",
            open && "rotate-180"
          )}
          strokeWidth={2}
        />
      </button>
      {(open || present) && (
        <JumpPanel
          active={open}
          anchor={anchor}
          triggerRef={triggerRef}
          onClose={(restoreFocus) => {
            onOpenChange(false);
            if (restoreFocus) triggerRef.current?.focus();
          }}
          onJump={onJump}
        />
      )}
    </div>
  );
}

function JumpPanel({
  active,
  anchor,
  triggerRef,
  onClose,
  onJump,
}: {
  active: boolean;
  anchor: Date;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus: boolean) => void;
  onJump: (date: Date, granularity: JumpGranularity) => void;
}) {
  const [text, setText] = useState("");
  const [year, setYear] = useState(anchor.getFullYear());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const target = useMemo(() => parseJumpTarget(text), [text]);
  const today = new Date();

  // Focus straight after commit, not on the next frame: a frame never comes
  // while the window is in the background.
  useEffect(() => {
    if (!active) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      const node = e.target as Node;
      if (ref.current?.contains(node) || triggerRef.current?.contains(node)) return;
      onClose(false);
    };
    // Esc closes it wherever focus happens to be (the trigger, the page), not
    // only from inside the panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      onClose(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, onClose, triggerRef]);

  function go(date: Date, granularity: JumpGranularity) {
    onJump(date, granularity);
    onClose(false);
  }

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-label="Jump to a date"
      aria-hidden={!active}
      data-no-shortcuts
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={active ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.97, y: -2 }}
      transition={active ? motionTokens.springSnappy : { duration: motionTokens.exit, ease: motionTokens.easeIn }}
      style={{ transformOrigin: "top left", pointerEvents: active ? "auto" : "none" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
      className="absolute left-0 top-[calc(100%+8px)] z-30 w-[296px] rounded-xl border border-line bg-surface p-3 shadow-[0_16px_40px_-14px_rgb(0_0_0/0.35)]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (target) go(target.date, target.granularity);
        }}
      >
        <label htmlFor="date-jump-input" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Go to
        </label>
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 transition-[border-color,box-shadow] duration-[var(--motion-standard)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-soft)]">
          <input
            id="date-jump-input"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Handled here rather than trusting implicit form submission,
              // which some keyboards and input methods never trigger.
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (target) go(target.date, target.granularity);
            }}
            placeholder="Dec 12, next Friday, 3/15…"
            autoComplete="off"
            className="min-h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={!target}
            aria-label="Go"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-accent transition-opacity disabled:opacity-30"
          >
            <CornerDownLeft className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
        <p className="mt-1.5 min-h-4 truncate text-[11.5px] text-ink-faint" aria-live="polite">
          {!text.trim()
            ? "Type a date, or pick a month below."
            : target
              ? target.granularity === "month"
                ? format(target.date, "MMMM yyyy")
                : format(target.date, "EEEE, MMMM d, yyyy")
              : "That doesn't look like a date yet."}
        </p>
      </form>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          aria-label="Previous year"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-[13px] font-semibold tabular-nums text-ink" aria-live="polite">
          {year}
        </span>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          aria-label="Next year"
          className="flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {MONTHS.map((label, i) => {
          const current = anchor.getFullYear() === year && anchor.getMonth() === i;
          const thisMonth = today.getFullYear() === year && today.getMonth() === i;
          return (
            <button
              key={label}
              type="button"
              onClick={() => go(new Date(year, i, 1), "month")}
              aria-current={current ? "date" : undefined}
              aria-label={format(new Date(year, i, 1), "MMMM yyyy")}
              className={cn(
                "relative h-9 rounded-md text-[12.5px] font-medium transition-colors duration-[var(--motion-micro)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                current ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
              )}
            >
              {label}
              {thisMonth && !current && (
                <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <span className="text-[11px] text-ink-faint">
          Press <kbd className="font-sans font-medium text-ink-soft">D</kbd> to open
        </span>
        <button
          type="button"
          onClick={() => go(startOfDay(today), "day")}
          className="h-8 rounded-md px-2.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Today
        </button>
      </div>
    </motion.div>
  );
}
