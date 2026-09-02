"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths } from "date-fns";
import { motion, useMotionValue, animate, useTransform } from "framer-motion";
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

const CHIP_HEIGHT = 20;
const CHIP_GAP = 4;
const MORE_LINE_HEIGHT = 14;

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
    <div ref={ref} className="hidden min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:flex">
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
              "cal-chip shrink-0 truncate rounded-[5px] px-1.5 py-[2px] text-[11px] font-medium leading-tight",
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
        <span className="shrink-0 px-1 text-[10.5px] font-medium leading-none text-ink-soft" title={hiddenTitles}>
          +{hiddenOpen}
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
              "press-none group relative flex min-h-[3.25rem] flex-col items-center justify-start gap-1 overflow-hidden rounded-lg border px-0.5 py-1.5 text-center sm:min-h-0 sm:items-stretch sm:justify-start sm:gap-1 sm:p-2 sm:text-left",
              "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
              "active:bg-surface-sunken",
              today ? "border-accent/40" : "border-transparent hover:border-line hover:bg-surface-sunken/60",
              !inMonth && "opacity-70"
            )}
          >
            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center sm:h-auto sm:w-auto sm:justify-start">
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
                  "sm:h-auto sm:min-w-0 sm:w-auto sm:rounded-none sm:p-0 sm:text-[12px]",
                  today
                    ? "bg-accent text-accent-ink sm:bg-transparent sm:text-accent"
                    : inMonth
                      ? "text-ink"
                      : "text-ink-faint"
                )}
              >
                {format(date, "d")}
              </span>
              {selected && showSelectionRing && (
                <SelectionRing
                  layoutId="month-selected-day-desktop"
                  animateSelection={animateSelection}
                  className="hidden rounded-lg ring-2 ring-inset ring-accent sm:block"
                />
              )}
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
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const dragging = useRef(false);
  const dragX = useMotionValue(0);
  const trackX = useTransform(dragX, (v) => (width ? -width + v : 0));

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

  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    const now = Date.now();
    swipeStart.current = { x: t.clientX, y: t.clientY, t: now };
    dragging.current = true;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragging.current || swipeStart.current == null || !width) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      const max = width * 0.92;
      dragX.set(Math.max(-max, Math.min(max, dx)));
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStart.current == null || !width) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    const dt = Math.max(1, Date.now() - swipeStart.current.t);
    const vx = (dx / dt) * 1000;
    swipeStart.current = null;
    dragging.current = false;

    const threshold = width * 0.18;
    const fling = Math.abs(vx) > 620;
    let commit: 1 | -1 | null = null;
    if (onSwipeMonth && Math.abs(dx) > Math.abs(dy) * 1.15) {
      if (dx < -threshold || (fling && vx < 0)) commit = 1;
      else if (dx > threshold || (fling && vx > 0)) commit = -1;
    }

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

  const byDay = useMemo(() => groupItemsByDay(items), [items]);

  const panelProps = {
    byDay,
    selectedDate,
    onSelectDate,
    weekStartsOn,
    colorOf,
    animateSelection: ringAnimated,
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface p-2 sm:p-3"
    >
      <div className="grid shrink-0 grid-cols-7 gap-1 px-0.5 pb-1.5 sm:gap-1.5 sm:px-1 sm:pb-2">
        {labels.map((l) => (
          <div key={l} className="text-center text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {l}
          </div>
        ))}
      </div>
      <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div className="flex h-full" style={{ x: trackX, width: width ? width * 3 : "300%" }}>
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
    </div>
  );
}
