"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths } from "date-fns";
import { motion, useMotionValue, animate, useTransform, type PanInfo } from "framer-motion";
import { isSameDay, isToday, format } from "date-fns";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { monthGrid, groupItemsByDay, dayKey, isOverdue, openItemsOnDay } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/types";

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_ITEMS: Item[] = [];

const CHIP_HEIGHT = 23;
const CHIP_GAP = 4;
const MORE_LINE_HEIGHT = 16;

function chipLabel(item: Item) {
  if (item.allDay) return item.title;
  const d = new Date(item.at);
  if (Number.isNaN(d.getTime())) return item.title;
  const h = d.getHours();
  const hour12 = h % 12 || 12;
  return `${hour12}${h >= 12 ? "p" : "a"} ${item.title}`;
}

function fitCountVertical(
  containerSize: number,
  itemCount: number,
  itemSize: number,
  gap: number,
  moreSize: number
) {
  if (itemCount === 0 || containerSize <= 0) return itemCount;
  const allSize = itemCount * itemSize + Math.max(0, itemCount - 1) * gap;
  if (allSize <= containerSize) return itemCount;
  const forItems = containerSize - moreSize - gap;
  const slot = itemSize + gap;
  return Math.max(0, Math.min(itemCount, Math.floor((forItems + gap) / slot)));
}

function rankForChip(item: Item) {
  if (isOverdue(item)) return 0;
  if (item.type !== "event" && item.status === "done") return 2;
  return 1;
}

/**
 * Chips for one day cell.
 *
 * Every cell used to run its own ResizeObserver to find out how many chips fit
 * — 42 per month panel, 126 across the swipe carousel, all re-measuring on
 * every resize for an answer that is identical in all of them (the grid rows
 * are `1fr`). Now one cell per panel reports its height (`onMeasure`) and the
 * rest are handed that number.
 */
function DayCellChips({
  items,
  colorOf,
  areaHeight,
  onMeasure,
}: {
  items: Item[];
  colorOf: (categoryId: string) => string;
  areaHeight: number;
  onMeasure?: (height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !onMeasure) return;
    const update = () => onMeasure(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onMeasure]);

  // Before the first measurement, show nothing rather than everything — a cell
  // that briefly renders its whole list and then trims reads as a flicker.
  const fitCount =
    areaHeight > 0
      ? fitCountVertical(areaHeight, items.length, CHIP_HEIGHT, CHIP_GAP, MORE_LINE_HEIGHT)
      : 0;

  const ranked = useMemo(
    () => [...items].sort((a, b) => rankForChip(a) - rankForChip(b)),
    [items]
  );
  const visible = ranked.slice(0, fitCount);
  const hiddenOpen = openItemsOnDay(ranked.slice(fitCount)).length;
  const hiddenTitles = ranked.slice(fitCount).map((i) => i.title).join(", ");

  return (
    <div ref={ref} className="relative z-[1] hidden min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:flex">
      {visible.map((item) => {
        const color = colorOf(item.categoryId);
        const done = item.type !== "event" && item.status === "done";
        const task = item.type !== "event";
        return (
          <motion.span
            key={item.id}
            layout="position"
            initial={{ opacity: 0, y: -2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: motionTokens.micro, ease: motionTokens.ease }}
            title={item.title}
            className={cn(
              "cal-chip shrink-0 truncate rounded-[5px] px-1.5 py-[3px] text-[12px] font-medium leading-[17px]",
              task && "cal-chip-task",
              done && "opacity-45",
              isOverdue(item) && "cal-chip-overdue"
            )}
            style={{ "--cat": color } as React.CSSProperties}
          >
            {chipLabel(item)}
          </motion.span>
        );
      })}
      {hiddenOpen > 0 && (
        <span
          className="shrink-0 px-1 pt-px text-[11.5px] font-medium leading-none text-ink-soft"
          title={hiddenTitles}
        >
          +{hiddenOpen} more
        </span>
      )}
    </div>
  );
}

function DayCellMobilePreview({
  items,
  colorOf,
}: {
  items: Item[];
  colorOf: (categoryId: string) => string;
}) {
  const open = openItemsOnDay(items);
  const overdue = items.some(isOverdue);
  if (open.length === 0) return null;
  const categories = [...new Set(open.map((i) => i.categoryId))].slice(0, 3);

  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5 sm:hidden">
      <span className={cn("text-[11px] font-medium tabular-nums leading-none", overdue ? "text-warn" : "text-ink-faint")}>
        {open.length}
      </span>
      {categories.length > 0 && (
        <div className="flex items-center gap-0.5">
          {categories.map((id) => (
            <span key={id} className="h-1.5 w-1.5 rounded-full" style={{ background: colorOf(id) }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The ring around the selected day. Before the first paint it is a plain
 *  element in the right place; once mounted it becomes a shared-layout element
 *  so picking another day slides it there. */
function SelectionRing({
  layoutId,
  animateSelection,
  className,
}: {
  layoutId: string;
  animateSelection: boolean;
  className: string;
}) {
  if (!animateSelection) {
    return <span aria-hidden className={cn("pointer-events-none absolute inset-0", className)} />;
  }
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      initial={false}
      transition={motionTokens.spring}
      className={cn("pointer-events-none absolute inset-0", className)}
    />
  );
}

function MonthGridPanel({
  anchor,
  byDay,
  selectedDate,
  onSelectDate,
  weekStartsOn,
  colorOf,
  showSelectionRing,
  animateSelection,
}: {
  anchor: Date;
  /** Items bucketed by day key — built once for all three carousel panels. */
  byDay: Map<string, Item[]>;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  weekStartsOn: 0 | 1;
  colorOf: (categoryId: string) => string;
  /** Only the on-screen month panel — avoids layoutId flying in from adjacent carousel panels. */
  showSelectionRing: boolean;
  /** False until the grid has been measured and painted once. The ring is a
   *  shared-layout element, so on arrival it would otherwise fly in from
   *  wherever framer last measured it (or from x=0, before the carousel knows
   *  its width) — it should simply already be around today's date, and only
   *  travel when you pick another day. */
  animateSelection: boolean;
}) {
  const grid = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const weeks = grid.length / 7;
  const [chipArea, setChipArea] = useState(0);
  // Identity has to be stable or the measuring cell re-subscribes every render.
  // The observer re-reports whenever the cell resizes, so a density change (or
  // any relayout) updates every cell in the panel from that one measurement.
  const onMeasure = useCallback((h: number) => setChipArea((prev) => (prev === h ? prev : h)), []);

  return (
    <div
      className="grid h-full min-h-0 w-full shrink-0 grid-cols-7 gap-1 overflow-hidden sm:gap-1.5"
      style={{ gridTemplateRows: `repeat(${weeks}, minmax(3.25rem, 1fr))` }}
    >
      {grid.map(({ date, inMonth }, cellIndex) => {
        const dayItems = byDay.get(dayKey(date)) ?? NO_ITEMS;
        const today = isToday(date);
        const selected = selectedDate && isSameDay(date, selectedDate);

        return (
          <button
            key={`${anchor.toISOString()}-${date.toISOString()}`}
            onClick={() => {
              haptic("light");
              onSelectDate(date);
            }}
            aria-pressed={selected ?? false}
            aria-label={
              `${format(date, "EEEE, MMMM d")}` +
              (today ? ", today" : "") +
              (dayItems.length ? `, ${dayItems.length} item${dayItems.length === 1 ? "" : "s"}` : ", nothing scheduled")
            }
            style={undefined}
            className={cn(
              "press-none group relative flex min-h-[3.25rem] flex-col items-center justify-start gap-1 overflow-hidden rounded-lg border px-0.5 py-1.5 text-center sm:min-h-0 sm:items-stretch sm:justify-start sm:gap-1 sm:p-1.5 sm:text-left",
              "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
              "active:bg-surface-sunken",
              // Today reads as a tinted cell plus a filled date badge; the ring
              // is reserved for selection, so the two never fight for the same
              // outline.
              today ? "border-transparent bg-accent-soft/60" : "border-transparent hover:bg-surface-sunken/60",
              !inMonth && "opacity-55"
            )}
          >
            {/* Desktop selection wraps the whole cell. It used to be an inset
                ring around just the date, sized to the text line — which drew
                straight through the digits. */}
            {selected && showSelectionRing && (
              <SelectionRing
                layoutId="month-selected-day-desktop"
                animateSelection={animateSelection}
                className="hidden rounded-lg ring-2 ring-inset ring-accent sm:block"
              />
            )}
            <span className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center sm:h-auto sm:w-auto sm:justify-start">
              {selected && showSelectionRing && (
                <SelectionRing
                  layoutId="month-selected-day"
                  animateSelection={animateSelection}
                  className="rounded-full ring-2 ring-accent sm:hidden"
                />
              )}
              <span
                className={cn(
                  "relative z-[1] flex h-8 w-8 min-w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
                  "transition-colors duration-[var(--motion-standard)]",
                  // Bigger than the old 12px, and today keeps its filled badge
                  // on desktop too, so "where am I" is answered at a glance.
                  "sm:h-[22px] sm:w-[22px] sm:min-w-0 sm:text-[13px]",
                  today
                    ? "bg-accent text-accent-ink"
                    : inMonth
                      ? "text-ink"
                      : "text-ink-faint"
                )}
              >
                {format(date, "d")}
              </span>
            </span>
            <DayCellMobilePreview items={dayItems} colorOf={colorOf} />
            <DayCellChips
              items={dayItems}
              colorOf={colorOf}
              areaHeight={chipArea}
              {...(cellIndex === 0 ? { onMeasure } : {})}
            />
          </button>
        );
      })}
    </div>
  );
}

export function MonthView({
  anchor,
  items,
  selectedDate,
  onSelectDate,
  onSwipeMonth,
}: {
  anchor: Date;
  items: Item[];
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  onSwipeMonth?: (dir: 1 | -1) => void;
}) {
  const weekStartsOn = useDatebookStore((s) => s.settings.weekStartsOn);
  const categories = useDatebookStore((s) => s.categories);
  const colorOf = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.color] as const));
    return (categoryId: string) => m.get(categoryId) ?? "#8a8a94";
  }, [categories]);
  const labels = weekStartsOn === 0 ? WEEKDAY_LABELS_SUN : WEEKDAY_LABELS_MON;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const dragX = useMotionValue(0);
  const trackX = useTransform(dragX, (v) => (width ? -width + v : 0));
  // A released drag ends on a pointerup over whichever day cell is under the
  // finger, which the browser then turns into a click on that button — so a
  // swipe used to also select the day it happened to land on. Mirrors the
  // `didDrag` guard the tab-bar pill uses for the same reason.
  const didPan = useRef(false);

  const prevAnchor = useMemo(() => addMonths(anchor, -1), [anchor]);
  const nextAnchor = useMemo(() => addMonths(anchor, 1), [anchor]);

  // Turned on one frame after the carousel has a width, so arriving on the
  // calendar shows the ring already in place instead of animating it there.
  const [ringAnimated, setRingAnimated] = useState(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width || ringAnimated) return;
    const id = requestAnimationFrame(() => setRingAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [width, ringAnimated]);

  useEffect(() => {
    dragX.set(0);
  }, [anchor, dragX]);

  // Driven by framer's own pan-gesture recognizer (a native PanSession, not
  // React's synthetic touch events) rather than raw onTouchStart/Move/End —
  // that manual path re-dispatched through React on every touchmove and left
  // the browser to decide, frame by frame, whether the gesture was a scroll
  // or a swipe, which is what read as dropped frames/choppiness once the grid
  // got busy. `onPan` batches to one update per animation frame and, paired
  // with `touch-action: pan-y` below, tells the browser up front that
  // horizontal motion here is ours, so the very first frame of a swipe is as
  // smooth as the rest of it. It also picks up mouse/trackpad dragging for
  // free, which the touch-only version never supported on desktop.
  function onPan(_event: PointerEvent, info: PanInfo) {
    if (!width) return;
    const { x: dx, y: dy } = info.offset;
    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > 4) didPan.current = true;
      const max = width * 0.92;
      dragX.set(Math.max(-max, Math.min(max, dx)));
    }
  }

  function onPanEnd(_event: PointerEvent, info: PanInfo) {
    if (!width) return;
    const { x: dx, y: dy } = info.offset;
    const vx = info.velocity.x;

    const threshold = width * 0.18;
    const fling = Math.abs(vx) > 620;
    let commit: 1 | -1 | null = null;
    if (onSwipeMonth && Math.abs(dx) > Math.abs(dy) * 1.15) {
      if (dx < -threshold || (fling && vx < 0)) commit = 1;
      else if (dx > threshold || (fling && vx > 0)) commit = -1;
    }

    // The click that follows this pointerup (if any) fires synchronously
    // before this timeout runs, so it still sees `didPan.current` — this only
    // clears a flag nothing ended up checking (a release over the gap between
    // cells), so the next real tap is never swallowed.
    if (didPan.current) setTimeout(() => (didPan.current = false), 0);

    if (commit) {
      haptic("light");
      const target = commit === 1 ? -width : width;
      void animate(dragX, target, motionTokens.springSnappy).then(() => {
        onSwipeMonth?.(commit!);
        dragX.set(0);
      });
      return;
    }

    void animate(dragX, 0, motionTokens.springSnappy);
  }

  const guardedSelectDate = useCallback(
    (date: Date) => {
      if (didPan.current) {
        didPan.current = false;
        return;
      }
      onSelectDate(date);
    },
    [onSelectDate]
  );

  const byDay = useMemo(() => groupItemsByDay(items), [items]);

  const panelProps = {
    byDay,
    selectedDate,
    onSelectDate: guardedSelectDate,
    weekStartsOn,
    colorOf,
    animateSelection: ringAnimated,
  };

  return (
    <motion.div
      onPan={onPan}
      onPanEnd={onPanEnd}
      style={{ touchAction: "pan-y" }}
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface p-2 sm:p-3"
    >
      <div className="grid shrink-0 grid-cols-7 gap-1 px-0.5 pb-1.5 sm:gap-1.5 sm:px-1 sm:pb-2">
        {labels.map((l) => (
          <div
            key={l}
            className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft sm:text-left sm:text-[11.5px]"
          >
            <span className="sm:hidden">{l.slice(0, 1)}</span>
            <span className="hidden sm:inline">{l}</span>
          </div>
        ))}
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div
          className="flex h-full"
          style={{ x: trackX, width: width ? width * 3 : "300%", willChange: "transform" }}
        >
          <div className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel anchor={prevAnchor} {...panelProps} showSelectionRing={false} />
          </div>
          <div className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel anchor={anchor} {...panelProps} showSelectionRing />
          </div>
          <div className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel anchor={nextAnchor} {...panelProps} showSelectionRing={false} />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
