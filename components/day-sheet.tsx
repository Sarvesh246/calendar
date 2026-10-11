"use client";

import { useMediaQuery } from "@/lib/use-media-query";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
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
import { startSheetDrag, useSheetOverscroll } from "@/lib/sheet-gesture";
import { useSheetPhysics } from "@/lib/use-sheet-physics";
import { Scrim } from "@/components/ui/scrim";
import { SheetHandle } from "@/components/sheet-handle";
import { motion as motionTokens, prefersReducedMotion, releaseSpring } from "@/lib/motion";
import { project } from "@/lib/gesture";
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

/** Full is for reading a long day; compact stops well short of the month grid. */
const FULL_HEIGHT = "min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 0.5rem))";
const compactHeight = () => Math.min(window.innerHeight * 0.46, 420);
/** How much of the page the scrim covers at the compact detent. */
const COMPACT_DIM = 0.35;

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
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * The detents are positions, not heights. The sheet is always full height
   * and the compact detent is the same sheet slid down — so a drag moves it
   * continuously between the two (and on down to closing) under the finger,
   * and the release lands on whichever detent the throw was heading for. A
   * height change can't be dragged; it could only be decided on release.
   */
  const sheet = useSheetPhysics({
    panelRef,
    onClosed: onClose,
    detents: () => {
      if (!window.matchMedia("(max-width: 767px)").matches) return [0];
      const h = panelRef.current?.offsetHeight ?? window.innerHeight;
      return [0, Math.max(0, h - compactHeight())];
    },
    initialDetent: phone ? 1 : 0,
    onDetent: (index) => setDetent(index === 0 ? "full" : "compact"),
  });
  const { dragControls, dragging } = sheet;
  const closeSheet = sheet.close;
  const setExpanded = (value: boolean) => sheet.snapTo(value ? 0 : 1);
  // At the compact detent the month has to stay legible — it is the thing
  // you are stepping through days *against* — so the veil is lighter there,
  // and it follows the sheet continuously in between.
  const scrim = useTransform(sheet.y, (v) => {
    const h = panelRef.current?.offsetHeight || 1;
    if (!phone) return Math.max(0, Math.min(1, 1 - v / h));
    const off = Math.max(1, h - compactHeight());
    if (v <= off) return 1 - (1 - COMPACT_DIM) * Math.max(0, v / off);
    return Math.max(0, COMPACT_DIM * (1 - (v - off) / Math.max(1, h - off)));
  });
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState(false);
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

  // A new day starts on its list, not on whatever item the last one had open.
  // Reset during render (same pattern as `travel` above) rather than in an
  // effect, so the old item never paints for a frame on the new day.
  const [shownDay, setShownDay] = useState(dayKeyValue);
  if (shownDay !== dayKeyValue) {
    setShownDay(dayKeyValue);
    setActiveItemId(null);
    setEditingItem(false);
  }
  useEffect(() => {
    listRef.current?.scrollTo(0, 0);
  }, [date]);

  // ---- Stepping days by swipe ------------------------------------------
  const dayX = useMotionValue(0);
  const dayAxis = useRef<"x" | "y" | null>(null);
  const dayPanned = useRef(false);
  const stepVelocity = useRef(0);
  const swipeDays = phone && Boolean(onStep) && !activeItem;

  // Every day change — swipe, chevrons, the calendar behind — brings the new
  // day in from the side it lies on, carrying a swipe's release speed.
  const shownDayKey = useRef(dayKeyValue);
  useLayoutEffect(() => {
    if (shownDayKey.current === dayKeyValue) return;
    shownDayKey.current = dayKeyValue;
    const velocity = stepVelocity.current;
    stepVelocity.current = 0;
    dayX.stop();
    if (prefersReducedMotion()) {
      dayX.set(0);
      return;
    }
    const w = listRef.current?.clientWidth ?? 360;
    dayX.set(direction * w * 0.32);
    void animate(dayX, 0, releaseSpring(velocity, 0.92, 0.4));
  }, [dayKeyValue, direction, dayX]);

  function onDayPanStart() {
    dayAxis.current = null;
    dayPanned.current = false;
  }

  function onDayPan(_: PointerEvent, info: PanInfo) {
    if (!swipeDays) return;
    const { x: dx, y: dy } = info.offset;
    if (dayAxis.current === null) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        dayAxis.current = "x";
        dayPanned.current = true;
        dayX.stop();
      } else if (Math.abs(dy) > 10) {
        dayAxis.current = "y";
      }
    }
    if (dayAxis.current === "x") dayX.set(dx);
  }

  function onDayPanEnd(_: PointerEvent, info: PanInfo) {
    const locked = dayAxis.current;
    dayAxis.current = null;
    // Cleared after the click that follows this release has been swallowed.
    if (dayPanned.current) window.setTimeout(() => (dayPanned.current = false), 0);
    if (locked !== "x" || !onStep) return;
    const w = listRef.current?.clientWidth ?? 360;
    const at = dayX.get();
    const v = info.velocity.x;
    const projected = project(at, v);
    if (Math.abs(projected) > w * 0.3 && Math.sign(projected) === Math.sign(at)) {
      haptic("selection");
      stepVelocity.current = v;
      onStep(projected < 0 ? 1 : -1);
      return;
    }
    void animate(dayX, 0, releaseSpring(v, 0.86, 0.36));
  }

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSheet();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, closeSheet]);

  if (!visible || typeof document === "undefined") return null;

  const close = () => closeSheet();
  // The sheet slides away under the composer rather than vanishing.
  const add = onAdd
    ? () => {
        closeSheet();
        onAdd();
      }
    : undefined;

  return createPortal(
    <div className={cn("fixed inset-0 z-[60] lg:hidden", sheet.leaving && "pointer-events-none")}>
      {/* Dimmed in proportion to how much the sheet is covering. At the compact
          detent the month has to stay legible — it is the thing you are
          stepping through days *against*. */}
      {/* Dismisses on press: the page is yours again the instant you touch it. */}
      <Scrim onPointerDown={close} progress={scrim} exitDuration={sheet.gone ? 0 : motionTokens.exit} />
      <motion.div
        role="dialog"
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={headingId}
        exit={
          sheet.gone
            ? { opacity: 1, transition: { duration: 0 } }
            : { y: "100%", transition: { duration: motionTokens.exit, ease: motionTokens.easeIn } }
        }
        {...sheet.dragProps}
        className="mobile-action-sheet absolute inset-x-0 bottom-0 z-[60] flex max-h-[min(92dvh,calc(100dvh-0.5rem))] flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface"
        style={{
          ...sheet.dragProps.style,
          paddingBottom: "max(0.75rem, var(--safe-bottom))",
          minHeight: !phone ? "min(72dvh, 640px)" : undefined,
          height: !phone ? undefined : FULL_HEIGHT,
        }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none select-none flex-col items-center pt-0.5 active:cursor-grabbing"
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
                onClick={(e) => { e.stopPropagation(); haptic("selection"); onStep(-1); }}
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
                  transition={{ default: motionTokens.nudge, opacity: { duration: motionTokens.standard, ease: motionTokens.ease } }}
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
                  onClick={(e) => { e.stopPropagation(); haptic("selection"); onStep(1); }}
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
                    add?.();
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
                  variant="inspector"
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
            <motion.div
              // Swipe the day sideways to step through days, the way the
              // calendar itself pages months. Vertical stays the list's.
              style={{ x: dayX, touchAction: "pan-y" }}
              onPanStart={onDayPanStart}
              onPan={onDayPan}
              onPanEnd={onDayPanEnd}
              onClickCapture={(e) => {
                // A swipe that ends over a card is not a tap on it.
                if (dayPanned.current) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {add && !phone && (
                <button
                  type="button"
                  onClick={add}
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
                  canAdd={Boolean(add)}
                  onAdd={add}
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
                        if (detent === "compact") setExpanded(true);
                      }}
                      {...chrome}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
