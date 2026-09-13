"use client";

import { useMediaQuery } from "@/lib/use-media-query";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { dayLabel } from "@/lib/date-utils";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import { ItemCard } from "@/components/item-card";
import { ListEmptyState } from "@/components/list-empty-state";
import { OverlapNotices } from "@/components/overlap-notice";
import { haptic } from "@/lib/haptic";
import { Scrim } from "@/components/ui/scrim";
import { motion as motionTokens } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";
import type { FilterBreakdown } from "@/lib/filters";
import type { OverlapGroup } from "@/lib/overlap";
import { useDialogFocus } from "@/lib/use-dialog-focus";

/** The heading travels the way the day did — the only cue that says which. */
const headingVariants = {
  enter: (d: number) => ({ opacity: 0, x: d > 0 ? 18 : -18 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d > 0 ? -18 : 18 }),
};

type Detent = "compact" | "full";

/** Compact stops well short of the month grid; full is for reading a long day. */
const DETENT_HEIGHT: Record<Detent, string> = {
  compact: "min(46dvh, 420px)",
  full: "min(88dvh, 780px)",
};

function useBelowLg() {
  const [below, setBelow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setBelow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return below;
}

export function DaySheet({
  date,
  items,
  onClose,
  onAdd,
  onStep,
  breakdown,
  overlaps = [],
}: {
  date: Date;
  items: Item[];
  onClose: () => void;
  onAdd?: () => void;
  onStep?: (direction: -1 | 1) => void;
  /** What the filters are hiding on this day, so "empty" can explain itself. */
  breakdown?: FilterBreakdown;
  overlaps?: OverlapGroup[];
}) {
  const visible = useBelowLg();
  const phone = useMediaQuery("(max-width: 767px)");
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, visible);
  useLockBodyScroll(visible);
  const dragControls = useDragControls();
  const closeGuard = useRef(false);
  const headingId = useId();
  const relative = dayLabel(date);
  const isRelative = relative === "Today" || relative === "Tomorrow" || relative === "Yesterday";
  // "Thursday, September 17" does not fit between a previous, a next, an expand
  // and a close button, and a truncated date is worse than a short one.
  const label = isRelative ? relative : format(date, "EEE, MMM d");
  const eventCount = items.filter((i) => i.type === "event").length;
  const dueCount = items.filter((i) => i.type !== "event" && i.status !== "done").length;
  const subtitle = isRelative
    ? format(date, "EEEE, MMMM d")
    : items.length === 0
      ? "Nothing scheduled"
      : [
          eventCount > 0 && `${eventCount} scheduled`,
          dueCount > 0 && `${dueCount} due`,
        ]
          .filter(Boolean)
          .join(" · ") || `${items.length} completed`;
  /**
   * Two heights, not one.
   *
   * The sheet used to size itself to its contents, which meant a busy day
   * covered the month and a quiet one left a gap — and either way the height
   * was a surprise. Two detents make it a place: `compact` deliberately stops
   * short so the month grid stays readable above it (the whole reason you
   * opened a day *from* the calendar), and `full` is for reading a long day.
   */
  const [detent, setDetent] = useState<Detent>("compact");
  const expanded = detent === "full";
  const setExpanded = (value: boolean) => setDetent(value ? "full" : "compact");
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const chrome = useItemCardChrome();
  const categories = useCategoriesById();

  /**
   * Which way the day last moved, so the heading can travel that way.
   *
   * Derived during render rather than in an effect: React re-runs this
   * component immediately on a render-phase update, before anything is
   * committed, so the direction is known on the same frame the new day is —
   * an effect would leave the first frame of the transition going the wrong way.
   */
  const dayKeyValue = date.toDateString();
  const [travel, setTravel] = useState<{ at: number; dir: 1 | -1 }>(() => ({
    at: date.getTime(),
    dir: 1,
  }));
  if (travel.at !== date.getTime()) {
    setTravel({ at: date.getTime(), dir: date.getTime() > travel.at ? 1 : -1 });
  }
  const direction = travel.dir;

  useEffect(() => {
    closeGuard.current = false;
    listRef.current?.scrollTo(0, 0);
  }, [date]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const close = () => {
    if (closeGuard.current) return;
    closeGuard.current = true;
    onClose();
  };

  return (
    <div className="viewport-pinned-overlay fixed inset-0 z-50 lg:hidden">
      {/* Dimmed in proportion to how much the sheet is covering. At the compact
          detent the month has to stay legible — it is the thing you are
          stepping through days *against*. */}
      <Scrim onClick={close} amount={expanded ? 1 : 0.35} />
      <motion.div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={headingId}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }}
        transition={motionTokens.springGentle}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.02, bottom: 0.6 }}
        dragTransition={{ bounceStiffness: 420, bounceDamping: 40 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          const flungDown = info.velocity.y > 700;
          const flungUp = info.velocity.y < -700;
          if (info.offset.y < -40 || flungUp) {
            if (!expanded) haptic("light");
            setDetent("full");
            return;
          }
          if (info.offset.y > 88 || flungDown) {
            haptic("light");
            // From full, a downward drag steps to compact rather than closing —
            // one gesture, one change, and the way back up is obvious.
            if (expanded) setDetent("compact");
            else close();
          }
        }}
        className="viewport-pinned-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[min(92dvh,calc(100dvh-2.5rem))] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface"
        style={{
          paddingBottom: "var(--safe-bottom)",
          minHeight: !phone ? "min(72dvh, 640px)" : undefined,
          height: !phone ? undefined : DETENT_HEIGHT[detent],
          transition: dragging ? "none" : "height var(--motion-emphasis) var(--ease-standard)",
        }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-2 active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <motion.span
            aria-hidden
            animate={{ scaleX: dragging ? 1.25 : 1, opacity: dragging ? 1 : 0.75 }}
            transition={motionTokens.springSnappy}
            className="h-1 w-10 rounded-full bg-line-strong"
          />
          <div className="flex w-full items-center justify-between gap-2 px-3 pb-2 pt-3">
            {/* Previous sits on the left of the title it changes, next on the
                right, so the control and the direction agree. */}
            {phone && onStep ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onStep(-1); }}
                aria-label="Previous day"
                className="press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : null}

            <div className="min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={dayKeyValue}
                  custom={direction}
                  variants={headingVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
                  className={cn(phone && onStep ? "text-center" : "text-left")}
                >
                  <p id={headingId} className="truncate text-[16px] font-semibold text-ink">
                    {label}
                  </p>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-faint">{subtitle}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex shrink-0 items-center" onPointerDown={e => e.stopPropagation()}>
              {phone && onStep && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); onStep(1); }}
                  aria-label="Next day"
                  className="press-none flex h-11 w-11 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken"
                >
                  <ChevronRight className="h-5 w-5" strokeWidth={2} />
                </button>
              )}
              {/* Changing detent was a drag and nothing else — unreachable by
                  keyboard, by switch control, and by anyone who can't make a
                  precise vertical gesture. Both directions, always. */}
              {phone && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    haptic("light");
                    setExpanded(!expanded);
                  }}
                  aria-label={expanded ? "Shrink this day" : "Expand this day"}
                  aria-expanded={expanded}
                  className="press-none flex h-11 w-11 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken"
                >
                  {expanded ? (
                    <ChevronDown className="h-5 w-5" strokeWidth={2} />
                  ) : (
                    <ChevronUp className="h-5 w-5" strokeWidth={2} />
                  )}
                </button>
              )}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                close();
              }}
              aria-label="Close"
              className="press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:text-ink active:bg-surface-sunken"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
            </div>
          </div>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-0 [-webkit-overflow-scrolling:touch]">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="mb-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line text-[13px] font-medium text-ink-soft transition-colors active:border-accent active:bg-accent-soft active:text-accent"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add to this day
            </button>
          )}
          {items.length === 0 ? (
            <ListEmptyState
              scope={format(date, "MMM d")}
              total={breakdown?.total ?? 0}
              hiddenByCategory={breakdown?.hiddenByCategory ?? 0}
              hiddenByCompletion={breakdown?.hiddenByCompletion ?? 0}
              canAdd={Boolean(onAdd)}
              onAdd={onAdd}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <OverlapNotices groups={overlaps} />
              {items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  category={item.categoryId ? categories.get(item.categoryId) : undefined}
                  day={date}
                  {...chrome}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
