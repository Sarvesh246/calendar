"use client";

import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import { format } from "date-fns";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { SHEET_DRAG, shouldDismissSheet, startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useKeepFieldVisible } from "@/lib/use-keep-field-visible";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { changeMobileStatus, mobileReschedule, relativeScheduleDate } from "@/lib/mobile-item-actions";
import { Reveal } from "@/components/ui/reveal";
import { SheetHandle } from "@/components/sheet-handle";
import { Scrim } from "@/components/ui/scrim";
import type { Item } from "@/lib/types";

/**
 * Every bottom sheet in the app, with one set of manners.
 *
 * Add, edit, search and the task actions all used to be their own arrangement
 * of scrim, corners and close button, and only one of them could be flicked
 * away. Worse, the grabber bar at the top — the universal "you can drag this"
 * — was decorative in every one of them, which is a promise the interface makes
 * and then doesn't keep.
 *
 * So: one component. Tap the scrim, press Escape, hit the close button, or
 * flick it down. All four always work, everywhere, and the grabber means what
 * it looks like it means.
 */
export function MobileItemSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  // The sheet owns its own dismissal so it can finish animating before the
  // parent unmounts it. Callers still just pass `onClose`; it now fires when
  // the sheet has actually left, not when the gesture started — which is what
  // stops the scrim, the tab bar and the save pill all snapping back into
  // place a frame before the card has gone.
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {open && <MobileItemSheetBody title={title} close={close}>{children}</MobileItemSheetBody>}
    </AnimatePresence>,
    document.body
  );
}

function MobileItemSheetBody({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const reduced = prefersReducedMotion();
  useDialogFocus(ref, true);
  useLockBodyScroll(true);
  // Search, the date pickers and the reschedule fields all live near the
  // bottom of a sheet the keyboard then covers.
  useKeepFieldVisible(ref, true);
  useSheetOverscroll(scrollRef, dragControls);

  return (
    <div className="fixed inset-0 z-[70]" onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); close(); } }}>
      <Scrim onClick={close} exitDuration={0.26} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : { y: "100%" }}
        animate={reduced ? { opacity: 1 } : { y: 0 }}
        exit={
          reduced
            ? { opacity: 0, transition: { duration: motionTokens.exit } }
            // Slides out, never fades: a sheet that goes translucent on the
            // way down shows the tab bar and the page through itself for a
            // few frames, which looks like a rendering fault rather than a
            // dismissal. iOS slides, so this slides.
            : { y: "100%", transition: { duration: 0.26, ease: motionTokens.easeIn } }
        }
        transition={motionTokens.springGentle}
        style={{ willChange: "transform" }}
        {...SHEET_DRAG}
        dragControls={dragControls}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          if (shouldDismissSheet(info)) {
            haptic("light");
            close();
          }
        }}
        className="mobile-action-sheet absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-surface px-4 pb-[max(1rem,var(--safe-bottom))] pt-0.5"
      >
        <SheetHandle dragControls={dragControls} dragging={dragging} />
        <header
          className="flex shrink-0 cursor-grab items-center justify-between gap-3 active:cursor-grabbing"
          onPointerDown={(e) => startSheetDrag(dragControls, e)}
        >
          <h2 className="min-w-0 truncate text-[16px] font-semibold">{title}</h2>
          <button aria-label="Close item sheet" className="press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken" onClick={close}><X className="h-5 w-5" /></button>
        </header>
        {/* `px-1 -mx-1` so a focus ring — which is drawn 2px *outside* the
            field — isn't shaved off by this scroll container's edges. A ring
            clipped on three sides reads as a rendering bug, not as focus. */}
        <div ref={scrollRef} className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 pt-1">{title === "Edit item" && <p className="text-[12px] text-ink-soft">Changes save as you edit.</p>}{children}</div>
      </motion.div>
    </div>
  );
}

const control =
  "press-none min-h-11 rounded-lg border border-line bg-surface-sunken px-3 text-[13px] text-ink";

/** The next Saturday — "this weekend" as a date you can hand to a picker. */
function nextWeekend(now = new Date()): string {
  const days = (6 - now.getDay() + 7) % 7 || 7;
  return relativeScheduleDate(days, now);
}

/**
 * Everything you can do to a task without opening its editor.
 *
 * The reschedule half used to be one date picker behind a "Reschedule options"
 * dropdown offering "Plan when to work" or "Change actual deadline". That is a
 * genuinely important distinction — moving a deadline changes what the app owes
 * you, planning a work session doesn't — and burying it in a select meant the
 * default silently decided it. Worse, on an imported assignment, "change the
 * deadline" quietly overrides what Canvas says is due.
 *
 * They are two destinations now, each with its own heading, its own explanation
 * and its own buttons. You cannot move a deadline by accident, because moving a
 * deadline is something you have to aim at.
 */
export function MobileTaskActions({
  item,
  onClose,
  onEdit,
  initialReschedule = false,
  hintSwipe = true,
  embedded = false,
}: {
  item: Item;
  onClose: () => void;
  onEdit: () => void;
  initialReschedule?: boolean;
  /** When Start/Reschedule buttons are on the card, don't advertise swipe. */
  hintSwipe?: boolean;
  /** Render inside DaySheet (or similar) instead of nesting another portal sheet. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(initialReschedule);
  const status = item.status ?? "todo";
  const isEvent = item.type === "event";
  const apply = (date: string, planWork: boolean) => {
    mobileReschedule(item, date, planWork);
    onClose();
  };

  const body = (
    <>
      <p className="mb-3 text-[12px] text-ink-soft">
        {isEvent ? "Starts" : "Due"}: {format(new Date(item.at), "EEE, MMM d · p")}
      </p>

      {!isEvent && (
        <>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1" aria-label="Task status">
            {(
              [
                ["todo", "To do"],
                ["doing", "In progress"],
                ["done", "Done"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={status === value}
                className={`${control} ${status === value ? "border-transparent bg-accent text-accent-ink" : "border-transparent bg-transparent"}`}
                onClick={() => {
                  changeMobileStatus(item, value);
                  onClose();
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {hintSwipe && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Or use the Start and Reschedule buttons on the card.
            </p>
          )}
        </>
      )}

      <div className="my-3 flex gap-2">
        <button className={`${control} flex-1`} aria-expanded={open} onClick={() => setOpen(!open)}>
          {isEvent ? "Move" : "Reschedule"}
        </button>
        <button className={`${control} flex-1`} onClick={onEdit}>
          Edit item
        </button>
      </div>

      <Reveal open={open}>
        <div className="space-y-4 border-t border-line pt-3">
          {/* Work sessions first: for an assignment it is almost always what
              "I'll do this tomorrow" actually means. */}
          {!isEvent && (
            <RescheduleGroup
              title="Plan a work session"
              detail="Adds a separate task for when you'll work on it. The deadline doesn't move."
              confirmLabel="Plan work"
              choices={[
                { label: "Tomorrow", date: relativeScheduleDate(1) },
                { label: "This weekend", date: nextWeekend() },
              ]}
              onApply={(date) => apply(date, true)}
            />
          )}

          <RescheduleGroup
            tone="warn"
            title={isEvent ? "Move this event" : "Move the deadline"}
            detail={
              isEvent
                ? "Changes when this event actually happens."
                : `Changes when this is actually due.${item.sourceId ? " This overrides the imported deadline." : ""}`
            }
            confirmLabel={isEvent ? "Move event" : "Change deadline"}
            choices={[
              { label: "Tomorrow", date: relativeScheduleDate(1) },
              { label: "Next week", date: relativeScheduleDate(7) },
            ]}
            onApply={(date) => apply(date, false)}
          />
        </div>
      </Reveal>
    </>
  );

  if (embedded) return body;
  return (
    <MobileItemSheet title={item.title} onClose={onClose}>
      {body}
    </MobileItemSheet>
  );
}

function RescheduleGroup({
  title,
  detail,
  confirmLabel,
  choices,
  onApply,
  tone = "plain",
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  choices: { label: string; date: string }[];
  onApply: (date: string) => void;
  tone?: "plain" | "warn";
}) {
  const [date, setDate] = useState(relativeScheduleDate(1));
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className={`text-[13px] font-semibold ${tone === "warn" ? "text-warn" : "text-ink"}`}
      >
        {title}
      </h3>
      <p className="mb-2 mt-0.5 text-[12px] text-ink-soft">{detail}</p>
      <div className="grid grid-cols-2 gap-2">
        {choices.map((choice) => (
          <button key={choice.label} className={control} onClick={() => onApply(choice.date)}>
            {choice.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-soft">
          <span className="shrink-0">Or</span>
          <input
            aria-label={`${title}: pick a date`}
            type="date"
            className={`${control} min-w-0 flex-1 text-[16px]`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          className={`${control} shrink-0 ${tone === "warn" ? "border-transparent bg-warn text-[var(--accent-ink)]" : "border-transparent bg-accent text-accent-ink"}`}
          disabled={!date}
          onClick={() => onApply(date)}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}
