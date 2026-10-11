"use client";

import { cn } from "@/lib/utils";
import { createContext, useCallback, useContext, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { useSheetPhysics } from "@/lib/use-sheet-physics";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { useKeepFieldVisible } from "@/lib/use-keep-field-visible";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { changeMobileStatus, mobileReschedule, relativeScheduleDate } from "@/lib/mobile-item-actions";
import { Reveal } from "@/components/ui/reveal";
import { SheetHandle } from "@/components/sheet-handle";
import { Scrim } from "@/components/ui/scrim";
import { ItemSummaryHeader } from "@/components/item-summary-header";
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
/**
 * Lets anything inside a sheet close it *with* its exit — an action that
 * finishes the job ("Done", "Move event") slides the sheet away exactly like
 * a flick does, instead of the parent unmounting it in one frame.
 */
const SheetCloseContext = createContext<(() => void) | null>(null);

/** Close the enclosing MobileItemSheet with its animation, if there is one. */
export function useCloseSheet(): (() => void) | null {
  return useContext(SheetCloseContext);
}

export function MobileItemSheet({ title, note, onClose, children }: { title: string; /** A quiet line above the content. */ note?: string; onClose: () => void; children: React.ReactNode }) {
  // The sheet owns its own departure: `onClose` fires once it has actually
  // left the screen, not when the gesture started — which is what stops the
  // scrim, the tab bar and the save pill snapping back a frame before the
  // card has gone.
  return createPortal(
    <MobileItemSheetBody title={title} note={note} onClosed={onClose}>{children}</MobileItemSheetBody>,
    document.body
  );
}

function MobileItemSheetBody({ title, note, onClosed, children }: { title: string; note?: string; onClosed: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheet = useSheetPhysics({ panelRef: ref, onClosed });
  const close = useCallback(() => sheet.close(), [sheet]);
  useDialogFocus(ref, true);
  useLockBodyScroll(true);
  // Search, the date pickers and the reschedule fields all live near the
  // bottom of a sheet the keyboard then covers.
  useKeepFieldVisible(ref, true);
  useSheetOverscroll(scrollRef, sheet.dragControls);

  return (
    <SheetCloseContext.Provider value={close}>
    <div className={cn("fixed inset-0 z-[70]", sheet.leaving && "pointer-events-none")} onClick={e => e.stopPropagation()} onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); close(); } }}>
      <Scrim onPointerDown={close} progress={sheet.scrimOpacity} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        {...sheet.dragProps}
        className="mobile-action-sheet absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-surface px-4 pb-[max(1rem,var(--safe-bottom))] pt-0.5"
      >
        <SheetHandle dragControls={sheet.dragControls} dragging={sheet.dragging} />
        <header
          className="native-sheet-header flex shrink-0 cursor-grab touch-none select-none items-center justify-between gap-3 active:cursor-grabbing"
          onPointerDown={(e) => startSheetDrag(sheet.dragControls, e)}
        >
          <h2 className="min-w-0 truncate text-[16px] font-semibold">{title}</h2>
          <button aria-label="Close item sheet" className="native-glass-control press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken" onClick={close}><X className="h-5 w-5" /></button>
        </header>
        {/* `px-1 -mx-1` so a focus ring — which is drawn 2px *outside* the
            field — isn't shaved off by this scroll container's edges. A ring
            clipped on three sides reads as a rendering bug, not as focus. */}
        <div ref={scrollRef} className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 pt-1">{note && <p className="mb-2 text-[12px] text-ink-faint">{note}</p>}{children}</div>
      </motion.div>
    </div>
    </SheetCloseContext.Provider>
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
interface TaskActionsProps {
  item: Item;
  onClose: () => void;
  onEdit: () => void;
  initialReschedule?: boolean;
  /** When Start/Reschedule buttons are on the card, don't advertise swipe. */
  hintSwipe?: boolean;
  /** Render inside DaySheet (or similar) instead of nesting another portal sheet. */
  embedded?: boolean;
}

export function MobileTaskActions(props: TaskActionsProps) {
  if (props.embedded) return <TaskActionsBody {...props} />;
  return (
    <MobileItemSheet title="Details" onClose={props.onClose}>
      <TaskActionsBody {...props} />
    </MobileItemSheet>
  );
}

function TaskActionsBody({
  item,
  onClose,
  onEdit,
  initialReschedule = false,
  hintSwipe = true,
  embedded = false,
}: TaskActionsProps) {
  const [open, setOpen] = useState(initialReschedule);
  const status = item.status ?? "todo";
  const isEvent = item.type === "event";
  const closeSheet = useCloseSheet();
  // Inside our own sheet, leave by sliding away; embedded, the host decides.
  const finish = () => (!embedded && closeSheet ? closeSheet() : onClose());
  const apply = (date: string, planWork: boolean) => {
    mobileReschedule(item, date, planWork);
    finish();
  };

  return (
    <>
      <ItemSummaryHeader item={item} />

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
                className={cn(
                  control,
                  "transition-colors duration-[var(--motion-micro)]",
                  status === value ? "border-transparent bg-accent font-medium text-accent-ink" : "border-transparent bg-transparent"
                )}
                onClick={() => {
                  changeMobileStatus(item, value);
                  finish();
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
        <button className={cn(control, "flex-1 transition-colors duration-[var(--motion-micro)]", open && "border-accent text-accent")} aria-expanded={open} onClick={() => setOpen(!open)}>
          {isEvent ? "Move" : "Reschedule"}
        </button>
        <button className={cn(control, "flex-1")} onClick={onEdit}>
          Edit details
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
            className={cn(control, "min-w-0 flex-1 text-[16px]")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <button
          className={cn(
            control,
            "shrink-0 border-transparent text-accent-ink",
            tone === "warn" ? "bg-warn" : "bg-accent"
          )}
          disabled={!date}
          onClick={() => onApply(date)}
        >
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}
