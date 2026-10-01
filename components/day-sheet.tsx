"use client";

import { useMediaQuery } from "@/lib/use-media-query";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { dayLabel } from "@/lib/date-utils";
import { useLockBodyScroll } from "@/lib/use-lock-body-scroll";
import { useCategoriesById, useItemCardChrome } from "@/lib/card-chrome";
import { ItemCard, StatusSegmented } from "@/components/item-card";
import { MobileTaskActions } from "@/components/mobile-item-sheet";
import { ListEmptyState } from "@/components/list-empty-state";
import { OverlapNotices } from "@/components/overlap-notice";
import { haptic } from "@/lib/haptic";
import { shouldDismissSheet, shouldExpandSheet, startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { Scrim } from "@/components/ui/scrim";
import { SheetHandle } from "@/components/sheet-handle";
import { motion as motionTokens, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";
import type { FilterBreakdown } from "@/lib/filters";
import type { OverlapGroup } from "@/lib/overlap";
import { useDialogFocus } from "@/lib/use-dialog-focus";

import { ItemEditor } from "@/components/item-editor-lazy";

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
  full: "min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 0.5rem))",
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
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState(false);
  const reduced = prefersReducedMotion();
  useSheetOverscroll(listRef, dragControls, visible, detent === "compact");
  const chrome = useItemCardChrome();
  const categories = useCategoriesById();
  const activeItem = activeItemId ? items.find((i) => i.id === activeItemId) : undefined;

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
    setActiveItemId(null);
    setEditingItem(false);
  }, [date]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onClose]);

  if (!visible || typeof document === "undefined") return null;

  const close = () => {
    if (closeGuard.current) return;
    closeGuard.current = true;
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] lg:hidden">
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
        dragElastic={{ top: expanded ? 0.04 : 0.55, bottom: 0.72 }}
        dragTransition={{ bounceStiffness: 380, bounceDamping: 34 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          if (shouldExpandSheet(info)) {
            if (!expanded) haptic("light");
            setDetent("full");
            return;
          }
          if (shouldDismissSheet(info)) {
            haptic("light");
            // From full, a downward drag steps to compact rather than closing —
            // one gesture, one change, and the way back up is obvious.
            if (expanded) setDetent("compact");
            else close();
          }
        }}
        className="mobile-action-sheet absolute inset-x-0 bottom-0 z-[60] flex max-h-[min(92dvh,calc(100dvh-0.5rem))] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface"
        style={{
          paddingBottom: "max(0.75rem, var(--safe-bottom))",
          minHeight: !phone ? "min(72dvh, 640px)" : undefined,
          height: !phone ? undefined : DETENT_HEIGHT[detent],
          transition: dragging || reduced ? "none" : "height var(--motion-emphasis) var(--ease-standard)",
        }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none flex-col items-center pt-0.5 active:cursor-grabbing"
          onPointerDown={(e) => startSheetDrag(dragControls, e)}
        >
          <SheetHandle dragControls={dragControls} dragging={dragging} className="py-2" />
          <div className="flex w-full items-center justify-between gap-2 px-3 pb-2 pt-3">
            {/* Previous sits on the left of the title it changes, next on the
                right, so the control and the direction agree. */}
            {phone && onStep && !activeItem ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onStep(-1); }}
                aria-label="Previous day"
                className="press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : phone && activeItem ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  haptic("light");
                  setEditingItem(false);
                  setActiveItemId(null);
                }}
                aria-label="Back to day"
                className="press-none flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft active:bg-surface-sunken"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2} />
              </button>
            ) : null}

            <div className="min-w-0 flex-1 overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={activeItem ? activeItem.id : dayKeyValue}
                  custom={direction}
                  variants={headingVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: motionTokens.standard, ease: motionTokens.ease }}
                  className={cn(phone && (onStep || activeItem) ? "text-center" : "text-left")}
                >
                  <p id={headingId} className="truncate text-[16px] font-semibold text-ink">
                    {activeItem ? activeItem.title : label}
                  </p>
                  <p className="mt-0.5 truncate text-[12.5px] text-ink-faint">
                    {activeItem ? (activeItem.type === "event" ? "Event" : "Assignment") : subtitle}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="flex shrink-0 items-center" onPointerDown={e => e.stopPropagation()}>
              {phone && onStep && !activeItem && (
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
              {phone && onAdd && !activeItem && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    haptic("light");
                    onAdd();
                  }}
                  aria-label="Add to this day"
                  className="press-none flex h-11 w-11 items-center justify-center rounded-full text-accent active:bg-accent-soft"
                >
                  <Plus className="h-5 w-5" strokeWidth={2} />
                </button>
              )}
              {/* Detent toggle stays one control; day stepping and Add lead. */}
              {phone && !activeItem && (
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
                  className="press-none flex h-11 w-11 items-center justify-center rounded-full text-ink-faint active:bg-surface-sunken"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4" strokeWidth={2} />
                  ) : (
                    <ChevronUp className="h-4 w-4" strokeWidth={2} />
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
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-8 pt-0 [-webkit-overflow-scrolling:touch]">
          {activeItem ? (
            editingItem || activeItem.type === "event" ? (
              <div className="pt-1">
                <p className="mb-2 text-[12px] text-ink-soft">Changes save as you edit.</p>
                <ItemEditor
                  item={activeItem}
                  category={activeItem.categoryId ? categories.get(activeItem.categoryId) : undefined}
                  clock24h={chrome.clock24h}
                  StatusSegmented={StatusSegmented}
                  onCollapse={() => {
                    setEditingItem(false);
                    setActiveItemId(null);
                  }}
                />
              </div>
            ) : (
              <MobileTaskActions
                item={activeItem}
                embedded
                hintSwipe={false}
                onClose={() => setActiveItemId(null)}
                onEdit={() => setEditingItem(true)}
              />
            )
          ) : (
            <>
              {onAdd && !phone && (
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
                  hiddenByView={breakdown?.hiddenByView ?? 0}
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
                      showQuickActions={false}
                      onMobileOpen={(opened) => {
                        setEditingItem(false);
                        setActiveItemId(opened.id);
                        if (detent === "compact") setDetent("full");
                      }}
                      {...chrome}
                    />
                  ))}
                </div>
              )}
              {phone && detent === "compact" && items.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    haptic("light");
                    setDetent("full");
                  }}
                  className="mt-3 mb-1 flex min-h-11 w-full items-center justify-center rounded-lg text-[13px] font-medium text-accent"
                >
                  Show more
                </button>
              )}
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
