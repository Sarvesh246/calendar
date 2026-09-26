"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addMonths } from "date-fns";
import { motion, useMotionValue, animate, useTransform, type PanInfo } from "framer-motion";
import { isSameDay, isToday, format } from "date-fns";
import { haptic } from "@/lib/haptic";
import { motion as motionTokens } from "@/lib/motion";
import { useDatebookStore } from "@/lib/store";
import { monthGrid, groupItemsByDay, dayKey, isEventEnded, isOverdue, openItemsOnDay, rankItemsByDay } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { useSlidingPill } from "@/lib/sliding-pill";
import type { Item } from "@/lib/types";
import { useNow } from "@/lib/use-now";
import { beginCalendarDrag, useCalendarDrag } from "@/lib/calendar-drag";
import { dayLabelFor, rescheduleToDay } from "@/lib/item-actions";
import { itemMenuProps } from "@/lib/item-menu";

const WEEKDAY_LABELS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NO_ITEMS: Item[] = [];

/** Design-time chip metrics. Real ones are measured — see `DayCellChips` — so
 *  a larger text size loses chips to the `+n more` rather than clipping them. */
const CHIP_HEIGHT = 23;
const CHIP_GAP = 4;
const MORE_LINE_HEIGHT = 16;

function chipLabel(item: Item, clock24h: boolean) {
  if (item.allDay) return item.title;
  const d = new Date(item.at);
  if (Number.isNaN(d.getTime())) return item.title;
  if (clock24h) return `${format(d, "H:mm")} ${item.title}`;
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

function DayCellChips({
  items,
  date,
  now,
  colorOf,
  areaHeight,
  clock24h,
  onMeasure,
}: {
  items: Item[];
  date: Date;
  now: Date;
  colorOf: (categoryId: string) => string;
  areaHeight: number;
  clock24h: boolean;
  onMeasure?: (height: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingId = useCalendarDrag((s) => s.sourceId);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Carry a chip to another day. A native listener, because the month's
  // swipe recognizer also listens natively on an ancestor — stopping the
  // press here is the only way to keep a drag from turning the month.
  // Touch keeps swiping; chips only drag with a mouse or pen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = dayKey(date);
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || ev.pointerType === "touch") return;
      const chip = (ev.target as HTMLElement).closest<HTMLElement>("[data-chip-id]");
      const item = chip && itemsRef.current.find((i) => i.id === chip.dataset.chipId);
      if (!item) return;
      ev.stopPropagation();
      beginCalendarDrag(ev, {
        accept: ["day"],
        sourceId: item.id,
        resolve: (t) =>
          t.kind === "day"
            ? { label: t.dayKey === key ? "Keep on this day" : `${item.type === "event" ? "Move to" : "Due"} ${dayLabelFor(t.dayKey)}` }
            : null,
        onDrop: (t) => {
          if (t.kind === "day") rescheduleToDay(item, t.dayKey, key);
        },
      });
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [date]);
  const chipRef = useRef<HTMLSpanElement>(null);
  // How tall a chip *actually* is. The constant above is what it measures at
  // the design text size; turn text up and the real chip is taller, so counting
  // with the constant fitted one chip too many and the cell clipped it.
  const [chipHeight, setChipHeight] = useState(CHIP_HEIGHT);

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
      ? fitCountVertical(
          areaHeight,
          items.length,
          chipHeight,
          CHIP_GAP,
          // The overflow line scales with the chips it stands in for.
          Math.round((MORE_LINE_HEIGHT / CHIP_HEIGHT) * chipHeight)
        )
      : 0;

  const visible = items.slice(0, fitCount);
  const hidden = items.slice(fitCount);
  const hiddenTitles = hidden.map((i) => i.title).join(", ");

  // Declared after `visible` so the dependency can name the node being watched.
  // Re-subscribing only when the first chip changes keeps this to one stable
  // observer per populated cell rather than a new one every render.
  const firstChipId = visible[0]?.id;
  useEffect(() => {
    const chip = chipRef.current;
    if (!chip) return;
    const read = () => {
      const height = Math.round(chip.getBoundingClientRect().height);
      if (height > 0) setChipHeight((prev) => (prev === height ? prev : height));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(chip);
    return () => ro.disconnect();
  }, [firstChipId]);

  return (
    <div ref={ref} className="month-day-chips relative z-[1] hidden min-h-0 w-full flex-1 flex-col gap-1 overflow-hidden sm:flex">
      {visible.map((item, index) => {
        const color = colorOf(item.categoryId);
        const done =
          (item.type !== "event" && item.status === "done") || isEventEnded(item, now, date);
        const task = item.type !== "event";
        return (
          <span
            key={item.id}
            ref={index === 0 ? chipRef : undefined}
            title={item.title}
            data-chip-id={item.id}
            {...itemMenuProps(item.id, dayKey(date))}
            className={cn(
              "cal-chip shrink-0 cursor-grab truncate rounded-[5px] px-1.5 py-[3px] text-[12px] font-medium leading-[17px] transition-opacity duration-[var(--motion-micro)]",
              task && "cal-chip-task",
              done && "opacity-45",
              isOverdue(item) && "cal-chip-overdue",
              draggingId === item.id && "opacity-30"
            )}
            style={{ "--cat": color } as React.CSSProperties}
          >
            {chipLabel(item, clock24h)}
          </span>
        );
      })}
      {hidden.length > 0 && (
        <span
          className="shrink-0 px-1 pt-px text-[11.5px] font-medium leading-none text-ink-soft"
          title={hiddenTitles}
        >
          +{hidden.length} more
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
  const event = open.find(i => i.type === "event");
  const due = open.find(i => i.type !== "event");
  const markers = [...new Map([event, due, ...open].filter((i): i is Item => Boolean(i)).map(i => [i.id, i])).values()].slice(0, 3);

  return (
    <div className="month-day-preview flex shrink-0 flex-col items-center gap-0.5 sm:hidden">
      <div className="flex items-center gap-1" aria-label={`${open.filter(i => i.type === "event").length} scheduled, ${open.filter(i => i.type !== "event").length} due`}>
        {markers.map(i => <span key={i.id} className={cn("h-1.5 w-1.5", i.type === "event" ? "rounded-full" : "rounded-[1px] rotate-45")} style={{ background: colorOf(i.categoryId) }} />)}
      </div>
      {open.length > 3 && <span className={cn("text-[10px] tabular-nums leading-none", overdue ? "text-warn" : "text-ink-faint")}>+{open.length - 3}</span>}
    </div>
  );
}

function MonthGridPanel({
  anchor,
  byDay,
  now,
  selectedDate,
  onSelectDate,
  weekStartsOn,
  colorOf,
  clock24h,
  showSelectionRing,
  animateSelection,
  showChips,
}: {
  clock24h: boolean;
  anchor: Date;
  byDay: Map<string, Item[]>;
  now: Date;
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  weekStartsOn: 0 | 1;
  colorOf: (categoryId: string) => string;
  showSelectionRing: boolean;
  animateSelection: boolean;
  showChips: boolean;
}) {
  const grid = useMemo(() => monthGrid(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const weeks = grid.length / 7;
  const [chipArea, setChipArea] = useState(0);
  // Identity has to be stable or the measuring cell re-subscribes every render.
  // The observer re-reports whenever the cell resizes, so a density change (or
  // any relayout) updates every cell in the panel from that one measurement.
  const onMeasure = useCallback((h: number) => setChipArea((prev) => (prev === h ? prev : h)), []);

  // The selection ring is one element per grid that slides between cells on
  // the compositor (see lib/sliding-pill.ts), instead of a shared-layout span
  // re-measured inside every cell. Desktop rings the whole cell; the phone
  // rings just the date.
  const selectedKey = showSelectionRing && selectedDate ? dayKey(selectedDate) : null;
  const { containerRef: gridRef, pillRef: ringRef, moveTo: moveRing } = useSlidingPill(selectedKey, {
    keyAttr: "data-drop-day",
    mark: false,
  });
  const { pillRef: dotRingRef, moveTo: moveDotRing } = useSlidingPill(selectedKey, {
    keyAttr: "data-ring-day",
    mark: false,
    container: gridRef,
  });

  return (
    <div
      ref={gridRef}
      className="month-grid-panel relative grid h-full min-h-0 w-full shrink-0 grid-cols-7 gap-1 overflow-hidden sm:gap-1.5"
      style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}
    >
      <span ref={ringRef} aria-hidden className="sliding-pill z-[2] hidden rounded-lg ring-2 ring-inset ring-accent sm:block" />
      <span ref={dotRingRef} aria-hidden className="sliding-pill z-[2] rounded-full ring-2 ring-accent sm:hidden" />
      {grid.map(({ date, inMonth }, cellIndex) => {
        const dayItems = byDay.get(dayKey(date)) ?? NO_ITEMS;
        const today = isToday(date);
        const selected = selectedDate && isSameDay(date, selectedDate);

        return (
          <button
            key={`${anchor.toISOString()}-${date.toISOString()}`}
            data-drop-day={dayKey(date)}
            onClick={(e) => {
              haptic("light");
              if (showSelectionRing && !selected) {
                const cell = e.currentTarget;
                if (animateSelection) {
                  moveRing(cell);
                  const dot = cell.querySelector<HTMLElement>("[data-ring-day]");
                  if (dot) moveDotRing(dot);
                }
              }
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
              "month-day-cell press-none group relative flex min-h-0 flex-col items-center justify-start gap-1 overflow-hidden rounded-lg border px-0.5 py-1 text-center sm:items-stretch sm:justify-start sm:gap-1 sm:p-1.5 sm:text-left",
              "transition-[background-color,border-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]",
              "active:bg-surface-sunken",
              // Today reads as a tinted cell plus a filled date badge; the ring
              // is reserved for selection, so the two never fight for the same
              // outline.
              today ? "border-transparent bg-accent-soft/60" : "border-transparent hover:bg-surface-sunken/60",
              !inMonth && "opacity-55"
            )}
          >
            <span data-ring-day={dayKey(date)} className="month-day-date-wrap relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center sm:h-auto sm:w-auto sm:justify-start">
              <span
                className={cn(
                  "month-day-date relative z-[1] flex h-8 w-8 min-w-8 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
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
            {showChips && (
              <DayCellChips
                items={dayItems}
                date={date}
                now={now}
                colorOf={colorOf}
                areaHeight={chipArea}
                clock24h={clock24h}
                {...(cellIndex === 0 ? { onMeasure } : {})}
              />
            )}
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
  const clock24h = useDatebookStore((s) => s.settings.clock24h);
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
  const [panAnchor, setPanAnchor] = useState<Date | null>(null);
  const paintNeighbors = panAnchor === anchor;

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
    return () => dragX.stop();
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
      if (Math.abs(dx) > 4) {
        didPan.current = true;
        if (!paintNeighbors) setPanAnchor(anchor);
      }
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

  const byDay = useMemo(() => rankItemsByDay(groupItemsByDay(items)), [items]);
  const now = useNow();

  const panelProps = {
    byDay,
    now,
    selectedDate,
    onSelectDate: guardedSelectDate,
    weekStartsOn,
    colorOf,
    clock24h,
    animateSelection: ringAnimated,
  };

  return (
    <motion.div
      onPan={onPan}
      onPanEnd={onPanEnd}
      data-page-swipe="off"
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
          <div aria-hidden inert className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel
              anchor={prevAnchor}
              {...panelProps}
              showSelectionRing={false}
              showChips={paintNeighbors}
            />
          </div>
          <div className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel anchor={anchor} {...panelProps} showSelectionRing showChips />
          </div>
          <div aria-hidden inert className="h-full shrink-0" style={{ width: width || "33.333%" }}>
            <MonthGridPanel
              anchor={nextAnchor}
              {...panelProps}
              showSelectionRing={false}
              showChips={paintNeighbors}
            />
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
